import { db } from './database_init.js';
import { EnhancedForecaster } from './forecast.js';
import { withLiveMembership } from './membership.js';
import { ref, get, onValue } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

const timeRange = document.getElementById('timeRange');
const rangeMonth = document.getElementById('rangeMonth');
const rangeCustom = document.getElementById('rangeCustom');
const rangeFrom = document.getElementById('rangeFrom');
const rangeTo = document.getElementById('rangeTo');
const rangeLabel = document.getElementById('rangeLabel');
const avgDailyVisitors = document.getElementById('avgDailyVisitors');
const peakHour = document.getElementById('peakHour');
const busiestDay = document.getElementById('busiestDay');
const avgStayTime = document.getElementById('avgStayTime');
const topMembersList = document.getElementById('topMembersList');
const peakHoursList = document.getElementById('peakHoursList');
const membershipStats = document.getElementById('membershipStats');
const aiNextHour = document.getElementById('aiNextHour');
const aiConfidence = document.getElementById('aiConfidence');
const growthText = document.getElementById('growthText');

let hourlyTrafficChart, dailyTrafficChart, membershipActivityChart, monthlyRevenueChart;

// Chart colours come from the active theme's CSS variables
function getColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim();
    const light = document.documentElement.dataset.mode === 'light';
    return {
        primary: v('--ac'), secondary: v('--ok'), accent: v('--in'), highlight: v('--bad'),
        lightGray: light ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)',
        darkGray: v('--mu'), tooltipBg: v('--s2'), tooltipTitle: v('--tx'), tooltipBody: v('--mu'),
        tooltipBorder: v('--bd'), doughnutBorder: v('--bg'), pointBorderColor: v('--bg')
    };
}
function rgbaOf(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }

const forecaster = new EnhancedForecaster();

const toInputDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Selected range: a preset (rolling N days), a specific month, or a custom from–to date range.
// Returns { start, end, days } or null while the admin hasn't filled in the dates yet.
function getRange() {
    const v = timeRange.value, now = new Date();
    let start, end = now;
    if (v === 'custom') {
        if (!rangeFrom.value || !rangeTo.value) return null;
        let a = new Date(rangeFrom.value + 'T00:00:00'), b = new Date(rangeTo.value + 'T23:59:59.999');
        if (a > b) { a = new Date(rangeTo.value + 'T00:00:00'); b = new Date(rangeFrom.value + 'T23:59:59.999'); }   // dates entered backwards: swap
        start = a; end = b;
    } else if (v === 'month') {
        if (!rangeMonth.value) return null;
        const [y, m] = rangeMonth.value.split('-').map(Number);
        start = new Date(y, m - 1, 1);
        end = new Date(y, m, 0, 23, 59, 59, 999);
    } else {
        start = new Date(now);
        start.setDate(start.getDate() - parseInt(v));
    }
    if (end > now) end = now;                       // nothing in the future
    return { start, end, days: Math.max(1, Math.ceil((end - start) / 86400000)) };
}

function onRangeModeChange() {
    const v = timeRange.value;
    rangeMonth.hidden = v !== 'month';
    rangeCustom.hidden = v !== 'custom';
    if (v === 'month' && !rangeMonth.value) rangeMonth.value = toInputDate(new Date()).slice(0, 7);
    if (v === 'custom' && !rangeFrom.value) {
        const f = new Date(); f.setDate(f.getDate() - 30);
        rangeFrom.value = toInputDate(f); rangeTo.value = toInputDate(new Date());
    }
    loadAnalyticsData();
}

function showRangeLabel(r) {
    if (timeRange.value !== 'month' && timeRange.value !== 'custom') { rangeLabel.textContent = ''; return; }
    const f = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    rangeLabel.textContent = `${f(r.start)} \u2013 ${f(r.end)} \u00b7 ${r.days} day${r.days === 1 ? '' : 's'}`;
}

function init() {
    setupFirebaseListeners();
    loadAnalyticsData();
    timeRange.addEventListener('change', onRangeModeChange);
    [rangeMonth, rangeFrom, rangeTo].forEach(el => el.addEventListener('change', loadAnalyticsData));
    rangeFrom.max = rangeTo.max = toInputDate(new Date());
    rangeMonth.max = toInputDate(new Date()).slice(0, 7);
    setInterval(updateDisplay, 60000);

    // Re-render charts when theme toggles
    const themeObserver = new MutationObserver(() => {
        if (hourlyTrafficChart || dailyTrafficChart || membershipActivityChart || monthlyRevenueChart) {
            loadAnalyticsData();
        }
    });
    themeObserver.observe(document.documentElement, { attributeFilter: ['data-theme'] });
}

function setupFirebaseListeners() {
    onValue(ref(db, 'WeeklyGrowthRate'), s => {
        const data = s.val();
        if (data && data.pct !== undefined) updateGrowthDisplay(data);
    });
}

function updateGrowthDisplay(data) {
    const pct = data.pct ?? 0;
    const trend = data.trend || (pct > 0 ? 'up' : pct < 0 ? 'down' : 'stable');
    const sign = pct > 0 ? '+' : '';
    growthText.textContent = `${sign}${pct}%`;

    if (pct >= 15) { growthText.style.color = getColors().secondary; }
    else if (pct > 0) { growthText.style.color = getColors().secondary; }
    else if (pct === 0) { growthText.style.color = getColors().darkGray; }
    else if (pct > -10) { growthText.style.color = getColors().primary; }
    else { growthText.style.color = getColors().highlight; }

    let trendEl = document.getElementById('growthTrend');
    if (!trendEl) {
        trendEl = document.createElement('div');
        trendEl.id = 'growthTrend';
        trendEl.style.cssText = 'font-size: 18px; margin-top: 4px; color: var(--mu);';
        growthText.parentNode.appendChild(trendEl);
    }
    const arrows = { up: '↑', down: '↓', stable: '→' };
    const label = pct >= 15 ? 'Excellent' : pct >= 5 ? 'Good' : pct >= -5 ? 'Stable' : 'Needs Attention';
    trendEl.innerHTML = `${arrows[trend] || '→'} <small style="font-size: 11px; color: var(--fa);">${label}</small>`;
}

function crowdColor(level) {
    const c = getColors();
    return level === 'Very Busy' ? c.highlight : level === 'Busy' ? c.primary : c.secondary;
}

function updatePredictionDisplay() {
    const p = forecaster.getPrediction();
    if (!p.ready) { aiNextHour.textContent = '—'; aiConfidence.textContent = p.factors[0]; return; }

    const level = p.closed ? 'Closed' : forecaster.level(p.raw), predColor = crowdColor(level);
    aiNextHour.textContent = p.raw < 10 ? p.raw.toFixed(1) : Math.round(p.raw);   // 0.4 expected arrivals is more useful than "0"
    aiNextHour.style.color = predColor;

    const confidencePct = Math.round(p.confidence * 100);
    const confidenceColor = confidencePct > 70 ? getColors().secondary : confidencePct > 40 ? getColors().primary : getColors().highlight;

    let confidenceBar = document.getElementById('confidenceBar');
    if (!confidenceBar) {
        confidenceBar = document.createElement('div');
        confidenceBar.id = 'confidenceBar';
        confidenceBar.style.cssText = 'width:100%;height:3px;background:var(--s3);border-radius:2px;margin-top:8px;overflow:hidden;';
        const fill = document.createElement('div');
        fill.id = 'confidenceFill';
        fill.style.cssText = 'height:100%;width:0%;transition:width 0.5s ease,background-color 0.3s ease;border-radius:2px;';
        confidenceBar.appendChild(fill);
        aiConfidence.parentNode.insertBefore(confidenceBar, aiConfidence.nextSibling);
    }
    const fill = document.getElementById('confidenceFill');
    fill.style.width = `${confidencePct}%`;
    fill.style.backgroundColor = confidenceColor;

    aiConfidence.textContent = p.closed ? p.factors[0] : `${confidencePct}% confidence \u2022 likely ${p.range[0]}\u2013${p.range[1]} check-ins \u2022 ${p.factors.join(', ')}`;
    aiConfidence.style.color = confidenceColor;

    let crowdLabel = document.getElementById('crowdLabel');
    if (!crowdLabel) {
        crowdLabel = document.createElement('div');
        crowdLabel.id = 'crowdLabel';
        crowdLabel.style.cssText = 'font-size: 11px; margin-top: 5px; text-transform: uppercase; letter-spacing: 1px;';
        aiNextHour.parentNode.appendChild(crowdLabel);
    }
    crowdLabel.textContent = level;
    crowdLabel.style.color = predColor;
}

function updateDisplay() { updatePredictionDisplay(); updateHourlyChartPrediction(); }

function calculateWeeklyGrowth(members) {
    const now = new Date();
    const lastWeekStart = new Date(now);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    lastWeekStart.setHours(0, 0, 0, 0);
    const prevWeekStart = new Date(lastWeekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);

    let lastWeekVisits = 0;
    let prevWeekVisits = 0;

    members.forEach(member => {
        (member.attendance_history || []).forEach(visit => {
            if (!visit.checkin) return;
            try {
                const visitDate = new Date(visit.checkin);
                if (visitDate >= lastWeekStart && visitDate <= now) lastWeekVisits++;
                else if (visitDate >= prevWeekStart && visitDate < lastWeekStart) prevWeekVisits++;
            } catch (e) {}
        });
    });

    const pct = prevWeekVisits > 0
        ? Math.round(((lastWeekVisits - prevWeekVisits) / prevWeekVisits) * 100)
        : (lastWeekVisits > 0 ? 100 : 0);

    updateGrowthDisplay({ pct, trend: pct > 0 ? 'up' : pct < 0 ? 'down' : 'stable' });
}

async function loadAnalyticsData() {
    const range = getRange();
    if (!range) return;
    showRangeLabel(range);
    try {
        const snapshot = await get(ref(db, 'Customers'));
        if (!snapshot.exists()) { showEmptyState(); return; }

        const members = [];
        const visitTimes = [];   // every check-in (members + walk-ins), whole history, for the forecaster

        snapshot.forEach(child => {
            const data = child.val();
            if (child.key.startsWith('_')) return;
            if (child.key.startsWith('WALKIN_')) {
                const t = Date.parse(data.gym_data?.last_checkin || data.timestamp);
                if (!isNaN(t)) visitTimes.push(t);
                return;
            }
            const member = normalizeMemberData(child.key, data);
            members.push(member);
            member.attendance_history.forEach(v => { const t = Date.parse(v.checkin); if (!isNaN(t)) visitTimes.push(t); });
        });

        forecaster.fit(visitTimes);
        processAnalytics(members, range);
        updatePredictionDisplay();
        calculateWeeklyGrowth(members);
        const revData = await buildMonthlyRevenueData();
        updateMonthlyRevenueChart(revData);
    } catch (error) {
        console.error('Error loading analytics:', error);
        showEmptyState();
    }
}

async function buildMonthlyRevenueData() {
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
            year: d.getFullYear(),
            month: d.getMonth(),
            label: d.toLocaleString('default', { month: 'short' }) + " '" + String(d.getFullYear()).slice(2)
        });
    }

    const memberRevenue = new Array(6).fill(0);
    const walkinRevenue = new Array(6).fill(0);

    try {
        const snapshot = await get(ref(db, 'Customers'));
        if (!snapshot.exists()) return { labels: months.map(m => m.label), memberRevenue, walkinRevenue };

        snapshot.forEach(child => {
            const data = child.val();

            if (child.key.startsWith('WALKIN_')) {
                let walkinDate = null;
                if (data.gym_data?.last_checkin) {
                    walkinDate = new Date(data.gym_data.last_checkin);
                } else if (data.timestamp) {
                    walkinDate = new Date(data.timestamp);
                } else {
                    const parts = child.key.split('_');
                    if (parts.length >= 3) {
                        const ts = parseInt(parts[parts.length - 1]);
                        if (!isNaN(ts) && ts > 1_000_000_000_000) walkinDate = new Date(ts);
                    }
                }
                if (walkinDate) {
                    const idx = months.findIndex(m => m.year === walkinDate.getFullYear() && m.month === walkinDate.getMonth());
                    if (idx >= 0) walkinRevenue[idx] += (data.payment || data.payment_amount || 40);
                }
                return;
            }

            const membership = data.membership || {};
            const startDateStr = membership.start_date;
            const monthsPaid = membership.months_paid || 1;
            const paymentAmt = membership.payment_amount || 0;
            const monthlyRate = paymentAmt > 0 ? paymentAmt / monthsPaid : (membership.monthly_rate || 0);

            if (!startDateStr || monthlyRate <= 0) return;

            const start = new Date(startDateStr);
            start.setHours(0, 0, 0, 0);
            const payEnd = new Date(start);
            payEnd.setMonth(payEnd.getMonth() + monthsPaid);

            months.forEach((m, idx) => {
                const mStart = new Date(m.year, m.month, 1);
                const mEnd   = new Date(m.year, m.month + 1, 0);
                if (start <= mEnd && payEnd >= mStart) {
                    memberRevenue[idx] += monthlyRate;
                }
            });
        });
    } catch (e) {
        console.error('Error building revenue data:', e);
    }

    return { labels: months.map(m => m.label), memberRevenue, walkinRevenue };
}

function updateMonthlyRevenueChart({ labels, memberRevenue, walkinRevenue }) {
    const colors = getColors();
    const ctx = document.getElementById('monthlyRevenueChart')?.getContext('2d');
    if (!ctx) return;
    if (monthlyRevenueChart) monthlyRevenueChart.destroy();

    const total = memberRevenue.map((v, i) => Math.round(v + walkinRevenue[i]));

    monthlyRevenueChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Member Fees',
                    data: memberRevenue.map(v => Math.round(v)),
                    backgroundColor: rgbaOf(getColors().primary,0.7),
                    borderColor: getColors().primary,
                    borderWidth: 1,
                    borderRadius: 6,
                    stack: 'rev'
                },
                {
                    label: 'Walk-in Fees',
                    data: walkinRevenue.map(v => Math.round(v)),
                    backgroundColor: rgbaOf(getColors().accent,0.7),
                    borderColor: getColors().accent,
                    borderWidth: 1,
                    borderRadius: 6,
                    stack: 'rev'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'top', labels: { color: colors.darkGray, font: { size: 12 }, usePointStyle: true } },
                tooltip: {
                    backgroundColor: colors.tooltipBg,
                    titleColor: colors.tooltipTitle,
                    bodyColor: colors.tooltipBody,
                    borderColor: colors.tooltipBorder,
                    borderWidth: 1,
                    cornerRadius: 8,
                    callbacks: {
                        afterBody: (items) => {
                            const idx = items[0].dataIndex;
                            return `Total: ₱${total[idx].toLocaleString()}`;
                        },
                        label: ctx => `${ctx.dataset.label}: ₱${Math.round(ctx.parsed.y).toLocaleString()}`
                    }
                }
            },
            scales: {
                y: {
                    stacked: true,
                    beginAtZero: true,
                    grid: { color: colors.lightGray, drawBorder: false },
                    ticks: { color: colors.darkGray, font: { size: 11 }, callback: v => `₱${v.toLocaleString()}` }
                },
                x: {
                    stacked: true,
                    grid: { display: false },
                    ticks: { color: colors.darkGray, font: { size: 12 } }
                }
            },
            animation: { duration: 800, easing: 'easeOutQuart' }
        }
    });
}

function processAnalytics(members, { start: startDate, end: endDate, days }) {

    const allVisits = [];
    const memberStats = {};
    const dailyCount = Array(7).fill(0);
    const dateCount = {};
    const stayTimes = [];
    const hourlyCount = Array(24).fill(0);   // check-ins per hour of day, inside the selected range
    let firstVisit = Infinity;

    members.forEach(member => {
        const memberVisits = member.attendance_history.filter(visit => {
            if (!visit.checkin) return false;
            try {
                const visitDate = new Date(visit.checkin);
                return visitDate >= startDate && visitDate <= endDate;
            } catch (e) { return false; }
        }).length;

        memberStats[member.uid] = { name: `${member.firstname} ${member.lastname}`, visits: memberVisits, membership: member.membership };

        member.attendance_history.forEach(visit => {
            if (!visit.checkin) return;
            try {
                const visitDate = new Date(visit.checkin);
                firstVisit = Math.min(firstVisit, visitDate.getTime());
                if (visitDate < startDate || visitDate > endDate) return;
                hourlyCount[visitDate.getHours()]++;
                const day = visitDate.getDay();
                const dateStr = visitDate.toISOString().split('T')[0];
                dailyCount[day]++;
                dateCount[dateStr] = (dateCount[dateStr] || 0) + 1;
                if (visit.time_spent) stayTimes.push(visit.time_spent);
                allVisits.push({ member, visit, hour: visitDate.getHours(), day, date: dateStr });
            } catch (e) {}
        });
    });

    // days of data actually inside the range (a gym with 10 days of history shouldn't divide by 30)
    const spanDays = Math.max(1, Math.ceil((endDate - Math.max(startDate.getTime(), isFinite(firstVisit) ? firstVisit : startDate.getTime())) / 86400000));

    updateSummaryCards(allVisits, dateCount, stayTimes, days, hourlyCount, dailyCount);
    updateCharts(hourlyCount, dailyCount, dateCount, members, allVisits, spanDays);
    updateDetailedStats(memberStats, hourlyCount, members);
}

function updateSummaryCards(visits, dateCount, stayTimes, days, hourlyCount, dailyCount) {
    const uniqueDates = Object.keys(dateCount).length;
    avgDailyVisitors.textContent = uniqueDates > 0 ? (visits.length / Math.min(uniqueDates, days)).toFixed(1) : '0';

    let maxHour = 0, maxCount = 0;
    for (let i = 0; i < 24; i++) { if (hourlyCount[i] > maxCount) { maxCount = hourlyCount[i]; maxHour = i; } }

    const fmtHour = h => h === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`;
    peakHour.textContent = maxCount > 0 ? fmtHour(maxHour) : '--:--';

    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    busiestDay.textContent = maxCount > 0 ? daysOfWeek[dailyCount.indexOf(Math.max(...dailyCount))] : '--';

    const avgStay = stayTimes.length > 0 ? Math.round(stayTimes.reduce((a, b) => a + b, 0) / stayTimes.length) : 0;
    avgStayTime.textContent = `${avgStay}m`;
}

function updateCharts(hourlyCount, dailyCount, dateCount, members, visits, spanDays) {
    updateHourlyTrafficChart(hourlyCount, spanDays);
    updateDailyTrafficChart(dateCount);
    updateMembershipActivityChart(members, visits);
    updateChartInsights(hourlyCount, dailyCount, dateCount, members, visits);
}

function updateChartInsights(hourlyCount, dailyCount, dateCount, members, visits) {
    const fmtHour = h => h === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`;

    // Hourly insight
    const maxCount = Math.max(...hourlyCount);
    const insightHourlyEl = document.getElementById('insightHourly');
    if (insightHourlyEl) {
        if (maxCount > 0) {
            const peakHr = hourlyCount.indexOf(maxCount);
            const morningAvg = hourlyCount.slice(6, 12).reduce((a, b) => a + b, 0);
            const eveningAvg = hourlyCount.slice(17, 22).reduce((a, b) => a + b, 0);
            const trend = eveningAvg > morningAvg ? 'evening crowd is heavier — consider extra staff after 5 PM' : 'mornings see more traffic — ideal for early-bird promotions';
            insightHourlyEl.textContent = `Peak activity is at ${fmtHour(peakHr)} with ${maxCount} check-ins; ${trend}.`;
        } else {
            insightHourlyEl.textContent = 'No check-in data yet — insights will appear once members start visiting.';
        }
    }

    // Daily trend insight
    const insightDailyEl = document.getElementById('insightDaily');
    if (insightDailyEl) {
        const dates = Object.keys(dateCount).sort();
        if (dates.length >= 4) {
            const half = Math.floor(dates.length / 2);
            const firstHalf = dates.slice(0, half).reduce((s, d) => s + dateCount[d], 0) / half;
            const secondHalf = dates.slice(half).reduce((s, d) => s + dateCount[d], 0) / (dates.length - half);
            const pct = firstHalf > 0 ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : 0;
            const dir = pct >= 0 ? `up ${pct}%` : `down ${Math.abs(pct)}%`;
            insightDailyEl.textContent = `Visitor traffic is ${dir} compared to the first half of the selected period${Math.abs(pct) < 5 ? ' — fairly steady overall' : ''}.`;
        } else if (dates.length > 0) {
            const avg = Math.round(Object.values(dateCount).reduce((a, b) => a + b, 0) / dates.length);
            insightDailyEl.textContent = `Averaging ${avg} visitor${avg !== 1 ? 's' : ''} per day — check back later for trend analysis as more data accumulates.`;
        } else {
            insightDailyEl.textContent = 'No visit data in the selected range yet.';
        }
    }

    // Membership activity insight
    const insightMembEl = document.getElementById('insightMembership');
    if (insightMembEl) {
        const activeMembers = members.filter(m => m.membership.status !== 'expired' && (m.membership.remaining_days === undefined || m.membership.remaining_days > 0)).length;
        const activeVisitors = new Set(visits.filter(v => v.member.membership.status !== 'expired').map(v => v.member.uid)).size;
        if (activeMembers > 0) {
            const engagePct = Math.round((activeVisitors / activeMembers) * 100);
            const engageLabel = engagePct >= 70 ? 'great engagement' : engagePct >= 40 ? 'moderate engagement' : 'low engagement';
            insightMembEl.textContent = `${engagePct}% of active members visited during this period — ${engageLabel}${engagePct < 40 ? '; consider a re-engagement campaign' : ''}.`;
        } else {
            insightMembEl.textContent = 'No active members found — register members to see engagement insights.';
        }
    }
}

function updateHourlyChartPrediction() {
    if (!hourlyTrafficChart) return;
    const p = forecaster.getPrediction();
    const ds = hourlyTrafficChart.data.datasets[1];
    if (!ds || !p.ready) return;
    const data = Array(24).fill(null);
    data[(new Date().getHours() + 1) % 24] = +p.raw.toFixed(1);
    ds.data = data;
    ds.label = `Forecast next hour: ${p.raw.toFixed(1)}`;
    ds.borderColor = ds.pointBackgroundColor = crowdColor(p.closed ? 'Closed' : forecaster.level(p.raw));
    hourlyTrafficChart.update('none');
}

function updateHourlyTrafficChart(hourlyCount, spanDays = 1) {
    const colors = getColors();
    const ctx = document.getElementById('hourlyTrafficChart').getContext('2d');
    if (hourlyTrafficChart) hourlyTrafficChart.destroy();

    const labels = Array.from({ length: 12 }, (_, i) => i === 0 ? '12AM' : `${i}AM`)
        .concat(Array.from({ length: 12 }, (_, i) => i === 0 ? '12PM' : `${i}PM`));

    const prediction = forecaster.getPrediction();
    const nextHourIndex = (new Date().getHours() + 1) % 24;
    const predictionData = Array(24).fill(null);
    if (prediction.ready) predictionData[nextHourIndex] = +prediction.raw.toFixed(1);
    const predColor = prediction.ready ? crowdColor(prediction.closed ? 'Closed' : forecaster.level(prediction.raw)) : getColors().primary;

    hourlyTrafficChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Avg check-ins per day',
                    data: hourlyCount.map(c => +(c / spanDays).toFixed(2)),
                    backgroundColor: rgbaOf(getColors().primary,0.5),
                    borderColor: getColors().primary,
                    borderWidth: 1,
                    borderRadius: 4,
                    barPercentage: 0.8
                },
                {
                    label: prediction.ready ? `Forecast next hour: ${prediction.raw.toFixed(1)}` : 'Forecast (not enough data)',
                    data: predictionData,
                    type: 'line',
                    borderColor: predColor,
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointBackgroundColor: predColor,
                    pointBorderColor: colors.pointBorderColor,
                    pointBorderWidth: 2,
                    pointRadius: 8,
                    pointHoverRadius: 10,
                    fill: false,
                    tension: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: true, position: 'top', labels: { color: colors.darkGray, font: { size: 12 }, usePointStyle: true } },
                tooltip: {
                    backgroundColor: colors.tooltipBg,
                    titleColor: colors.tooltipTitle,
                    bodyColor: colors.tooltipBody,
                    borderColor: colors.tooltipBorder,
                    borderWidth: 1,
                    cornerRadius: 8,
                    callbacks: {
                        label: ctx => ctx.datasetIndex === 1 ? `${ctx.parsed.y} expected (likely ${prediction.range[0]}\u2013${prediction.range[1]})` : `${ctx.parsed.y} check-ins/day`,
                        afterLabel: ctx => ctx.datasetIndex === 1 ? `Confidence: ${Math.round(prediction.confidence * 100)}%` : undefined
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: colors.lightGray, drawBorder: false },
                    ticks: { color: colors.darkGray, font: { size: 11 }, callback: v => Number.isInteger(v) ? v : '' },
                    title: { display: true, text: 'Check-ins per hour', color: colors.darkGray }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: colors.darkGray, font: { size: 10 }, maxRotation: 0 },
                    title: { display: true, text: 'Hour', color: colors.darkGray }
                }
            },
            animation: { duration: 800, easing: 'easeOutQuart' }
        }
    });
}

function updateDailyTrafficChart(dateCount) {
    const colors = getColors();
    const ctx = document.getElementById('dailyTrafficChart').getContext('2d');
    if (dailyTrafficChart) dailyTrafficChart.destroy();

    const dates = Object.keys(dateCount).sort();
    const values = dates.map(d => dateCount[d]);
    const formattedDates = dates.map(d => { const dt = new Date(d); return `${dt.getMonth() + 1}/${dt.getDate()}`; });

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, rgbaOf(getColors().primary,0.3));
    gradient.addColorStop(1, rgbaOf(getColors().primary,0.02));

    dailyTrafficChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: formattedDates,
            datasets: [{
                label: 'Daily Traffic',
                data: values,
                backgroundColor: gradient,
                borderColor: getColors().primary,
                borderWidth: 2,
                tension: 0.3,
                fill: true,
                pointBackgroundColor: getColors().primary,
                pointBorderColor: colors.pointBorderColor,
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: colors.tooltipBg,
                    titleColor: colors.tooltipTitle,
                    bodyColor: colors.tooltipBody,
                    borderColor: colors.tooltipBorder,
                    borderWidth: 1,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: { label: ctx => `${ctx.parsed.y} visitors` }
                }
            },
            scales: {
                y: { beginAtZero: true, grid: { color: colors.lightGray, drawBorder: false }, ticks: { color: colors.darkGray } },
                x: { grid: { color: colors.lightGray, drawBorder: false }, ticks: { color: colors.darkGray, maxRotation: 45 } }
            },
            animation: { duration: 800, easing: 'easeOutQuart' }
        }
    });
}

function updateMembershipActivityChart(members, visits) {
    const colors = getColors();
    const ctx = document.getElementById('membershipActivityChart').getContext('2d');
    if (membershipActivityChart) membershipActivityChart.destroy();

    const activeMembers = members.filter(m => m.membership.status !== 'expired' && (m.membership.remaining_days === undefined || m.membership.remaining_days > 0)).length;
    const expiredMembers = members.filter(m => m.membership.status === 'expired' || (m.membership.remaining_days !== undefined && m.membership.remaining_days <= 0)).length;
    const activeVisitors = new Set(visits.filter(v => v.member.membership.status !== 'expired').map(v => v.member.uid));
    const activeVisited = activeVisitors.size;
    const activeNotVisited = activeMembers - activeVisited;

    membershipActivityChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Active & Visiting', 'Active (Not Visiting)', 'Expired'],
            datasets: [{
                data: [activeVisited, activeNotVisited, expiredMembers],
                backgroundColor: [getColors().secondary, getColors().primary, getColors().highlight],
                borderColor: colors.doughnutBorder,
                borderWidth: 3,
                hoverOffset: 12
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: { position: 'bottom', labels: { color: colors.darkGray, font: { size: 12 }, padding: 20, usePointStyle: true } },
                tooltip: {
                    backgroundColor: colors.tooltipBg,
                    titleColor: colors.tooltipTitle,
                    bodyColor: colors.tooltipBody,
                    borderColor: colors.tooltipBorder,
                    borderWidth: 1,
                    cornerRadius: 8,
                    callbacks: {
                        label: ctx => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            return `${ctx.label}: ${ctx.parsed} (${Math.round((ctx.parsed / total) * 100)}%)`;
                        }
                    }
                }
            },
            animation: { animateScale: true, animateRotate: true, duration: 1000 }
        }
    });
}

function updateDetailedStats(memberStats, hourlyCount, members) {
    const topMembers = Object.values(memberStats).filter(m => m.visits > 0).sort((a, b) => b.visits - a.visits).slice(0, 5);

    topMembersList.innerHTML = topMembers.length > 0 ?
        topMembers.map(m => `<div class="stat-item"><span>${m.name}</span><span class="value">${m.visits} visits</span></div>`).join('') :
        '<div class="stat-item" style="color:var(--fa)">No visits recorded</div>';

    const fmtHour = h => h === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`;
    const peakHoursSorted = hourlyCount.map((count, hour) => ({ hour, count })).filter(h => h.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);

    peakHoursList.innerHTML = peakHoursSorted.length > 0 ?
        peakHoursSorted.map(({ hour, count }) => `<div class="stat-item"><span>${fmtHour(hour)}</span><span class="value">${count} check-ins</span></div>`).join('') :
        '<div class="stat-item" style="color:var(--fa)">No check-in data</div>';

    const activeCount = members.filter(m => m.membership.status !== 'expired' && (m.membership.remaining_days === undefined || m.membership.remaining_days > 0)).length;
    const expiredCount = members.filter(m => m.membership.status === 'expired' || (m.membership.remaining_days !== undefined && m.membership.remaining_days <= 0)).length;

    membershipStats.innerHTML = `
        <div class="stat-item"><span>Active Members</span><span class="value" style="color:var(--ok)">${activeCount}</span></div>
        <div class="stat-item"><span>Expired Members</span><span class="value" style="color:var(--bad)">${expiredCount}</span></div>
        <div class="stat-item"><span>Total Members</span><span class="value">${members.length}</span></div>`;
}

function normalizeMemberData(key, data) {
    const uid = data.gym_data?.uid || data.personal_info?.uid || data.uid || key;
    let attendance_history = [];
    if (Array.isArray(data.attendance_history)) {
        attendance_history = data.attendance_history;
    } else if (data.attendance_history && typeof data.attendance_history === 'object') {
        attendance_history = Object.values(data.attendance_history);
    }

    const gym_data = {
        is_checked_in: data.gym_data?.is_checked_in || false,
        last_checkin: data.gym_data?.last_checkin || null,
        last_checkout: data.gym_data?.last_checkout || null
    };

    if (gym_data.last_checkin && !attendance_history.some(v => v.checkin === gym_data.last_checkin)) {
        attendance_history.push({ checkin: gym_data.last_checkin, checkout: gym_data.last_checkout, time_spent: null });
    }

    return {
        key, uid,
        firstname: data.personal_info?.firstname || '',
        lastname: data.personal_info?.lastname || '',
        membership: withLiveMembership(data.membership),
        gym_data,
        attendance_history
    };
}

function showEmptyState() {
    avgDailyVisitors.textContent = '0';
    peakHour.textContent = '--:--';
    busiestDay.textContent = '--';
    avgStayTime.textContent = '0m';
    aiNextHour.textContent = '—';
    aiConfidence.textContent = 'No data yet';
    growthText.textContent = '—';

    const els = ['growthTrend', 'confidenceBar', 'crowdLabel'];
    els.forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });

    topMembersList.innerHTML = '<div class="stat-item" style="color:var(--fa)">No data available</div>';
    peakHoursList.innerHTML = '<div class="stat-item" style="color:var(--fa)">No data available</div>';
    membershipStats.innerHTML = '<div class="stat-item" style="color:var(--fa)">No data available</div>';

    updateHourlyTrafficChart(Array(24).fill(0), []);
    updateDailyTrafficChart({});
    updateMembershipActivityChart([], []);
}

document.addEventListener('DOMContentLoaded', init);
