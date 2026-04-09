import { db } from './database_init.js';
import { ref, get, onValue } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

const timeRange = document.getElementById('timeRange');
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

// Dark-theme adapted colors
const colors = {
    primary: '#ebc069',
    secondary: '#1db954',
    accent: '#4fc3f7',
    highlight: '#f15e6c',
    lightGray: 'rgba(255,255,255,0.07)',
    darkGray: '#b3b3b3'
};

const historicalCache = { hourlyPatterns: {}, dailyTotals: [], lastUpdated: null };

class EnhancedForecaster {
    constructor() {
        this.currentPrediction = { prediction: 0, confidence: 0, factors: [] };
        this.lastUpdate = null;
    }

    buildPatterns(members, days = 30) {
        const patterns = {};
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        for (let d = 0; d < 7; d++) {
            patterns[d] = {};
            for (let h = 0; h < 24; h++) {
                patterns[d][h] = { sum: 0, count: 0 };
            }
        }

        members.forEach(member => {
            (member.attendance_history || []).forEach(visit => {
                if (!visit.checkin) return;
                try {
                    const visitDate = new Date(visit.checkin);
                    if (visitDate < startDate || visitDate > endDate) return;
                    const day = visitDate.getDay();
                    const hour = visitDate.getHours();
                    patterns[day][hour].sum += 1;
                    patterns[day][hour].count += 1;
                } catch (e) {}
            });
        });

        for (let d = 0; d < 7; d++) {
            for (let h = 0; h < 24; h++) {
                const p = patterns[d][h];
                patterns[d][h] = p.count > 0 ? p.sum / p.count : 0;
            }
        }

        historicalCache.hourlyPatterns = patterns;
        return patterns;
    }

    setPredictionFromFirebase(data) {
        if (data && data.nextHour !== undefined) {
            let confidence = data.confidence || 0.5;
            const factors = [];
            if (data.timestamp) {
                const age = (new Date() - new Date(data.timestamp)) / (1000 * 60);
                if (age < 5) { confidence = Math.min(0.95, confidence + 0.1); factors.push('fresh data'); }
                else if (age < 30) { factors.push('recent data'); }
            }
            this.currentPrediction = {
                prediction: Math.round(data.nextHour),
                confidence,
                timestamp: new Date(data.timestamp || new Date()),
                factors,
                trend: data.trend || 'stable'
            };
            this.lastUpdate = new Date();
            return true;
        }
        return false;
    }

    calculateEnhancedPrediction(hourlyData, members) {
        const now = new Date();
        const currentHour = now.getHours();
        const nextHour = (currentHour + 1) % 24;
        const dayOfWeek = now.getDay();

        if (Object.keys(historicalCache.hourlyPatterns).length === 0) {
            this.buildPatterns(members);
        }

        const patterns = historicalCache.hourlyPatterns;
        const factors = [];

        const historicalAvg = patterns[dayOfWeek]?.[nextHour] || 0;
        if (historicalAvg > 0) factors.push('historical pattern');

        const recentHours = [
            hourlyData[currentHour] || 0,
            hourlyData[(currentHour + 23) % 24] || 0,
            hourlyData[(currentHour + 22) % 24] || 0
        ];
        const momentum = recentHours[0] > recentHours[1] ? 'rising' : recentHours[0] < recentHours[1] ? 'falling' : 'stable';
        const momentumAvg = recentHours.reduce((a, b) => a + b, 0) / 3;
        if (momentumAvg > 0) factors.push(`${momentum} trend`);

        const yesterdaySameHour = patterns[(dayOfWeek + 6) % 7]?.[nextHour] || 0;
        if (yesterdaySameHour > 0) factors.push('yesterday comparison');

        const currentBaseline = hourlyData[currentHour] || 0;
        const prediction = Math.round(historicalAvg * 0.4 + momentumAvg * 0.3 + yesterdaySameHour * 0.2 + currentBaseline * 0.1);

        let confidence = 0.3;
        if (historicalAvg > 0) confidence += 0.25;
        if (momentumAvg > 0) confidence += 0.2;
        if (yesterdaySameHour > 0) confidence += 0.15;
        if (currentBaseline > 0) confidence += 0.1;

        return {
            prediction: Math.max(3, Math.min(50, prediction)),
            confidence: Math.min(0.95, confidence),
            timestamp: now,
            factors,
            trend: momentum
        };
    }

    getPrediction(hourlyData = [], members = []) {
        if (this.lastUpdate) {
            const minutesSinceUpdate = (new Date() - this.lastUpdate) / (1000 * 60);
            if (minutesSinceUpdate < 2) return this.currentPrediction;
        }
        return this.calculateEnhancedPrediction(hourlyData, members);
    }
}

const forecaster = new EnhancedForecaster();

function init() {
    setupFirebaseListeners();
    loadAnalyticsData();
    timeRange.addEventListener('change', loadAnalyticsData);
    setInterval(updateDisplay, 60000);
}

function setupFirebaseListeners() {
    onValue(ref(db, 'Trend24h'), snap => {
        const data = snap.val();
        if (data && forecaster.setPredictionFromFirebase(data)) {
            updatePredictionDisplay();
            if (hourlyTrafficChart) setTimeout(() => updateHourlyChartPrediction(), 100);
        }
    });

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

    if (pct >= 15) { growthText.style.color = '#1db954'; }
    else if (pct > 0) { growthText.style.color = '#5cb85c'; }
    else if (pct === 0) { growthText.style.color = '#b3b3b3'; }
    else if (pct > -10) { growthText.style.color = '#ebc069'; }
    else { growthText.style.color = '#f15e6c'; }

    let trendEl = document.getElementById('growthTrend');
    if (!trendEl) {
        trendEl = document.createElement('div');
        trendEl.id = 'growthTrend';
        trendEl.style.cssText = 'font-size: 18px; margin-top: 4px; color: #b3b3b3;';
        growthText.parentNode.appendChild(trendEl);
    }
    const arrows = { up: '↑', down: '↓', stable: '→' };
    const label = pct >= 15 ? 'Excellent' : pct >= 5 ? 'Good' : pct >= -5 ? 'Stable' : 'Needs Attention';
    trendEl.innerHTML = `${arrows[trend] || '→'} <small style="font-size: 11px; color: #6a6a6a;">${label}</small>`;
}

function updatePredictionDisplay() {
    const prediction = forecaster.getPrediction();
    aiNextHour.textContent = prediction.prediction;

    const predColor = prediction.prediction >= 30 ? '#f15e6c' : prediction.prediction >= 15 ? '#ebc069' : '#1db954';
    aiNextHour.style.color = predColor;

    const confidencePct = Math.round(prediction.confidence * 100);
    const confidenceColor = confidencePct > 70 ? '#1db954' : confidencePct > 40 ? '#ebc069' : '#f15e6c';

    let confidenceBar = document.getElementById('confidenceBar');
    if (!confidenceBar) {
        confidenceBar = document.createElement('div');
        confidenceBar.id = 'confidenceBar';
        confidenceBar.style.cssText = 'width:100%;height:3px;background:#282828;border-radius:2px;margin-top:8px;overflow:hidden;';
        const fill = document.createElement('div');
        fill.id = 'confidenceFill';
        fill.style.cssText = 'height:100%;width:0%;transition:width 0.5s ease,background-color 0.3s ease;border-radius:2px;';
        confidenceBar.appendChild(fill);
        aiConfidence.parentNode.insertBefore(confidenceBar, aiConfidence.nextSibling);
    }

    const fill = document.getElementById('confidenceFill');
    if (fill) { fill.style.width = `${confidencePct}%`; fill.style.backgroundColor = confidenceColor; }

    const factorText = prediction.factors?.length > 0 ? ` • ${prediction.factors.slice(0, 2).join(', ')}` : '';
    aiConfidence.textContent = `${confidencePct}% confidence${factorText}`;
    aiConfidence.style.color = confidenceColor;

    let crowdLabel = document.getElementById('crowdLabel');
    if (!crowdLabel) {
        crowdLabel = document.createElement('div');
        crowdLabel.id = 'crowdLabel';
        crowdLabel.style.cssText = 'font-size: 11px; margin-top: 5px; text-transform: uppercase; letter-spacing: 1px;';
        aiNextHour.parentNode.appendChild(crowdLabel);
    }
    const crowdLevel = prediction.prediction >= 30 ? 'Very Busy' : prediction.prediction >= 20 ? 'Busy' : prediction.prediction >= 10 ? 'Moderate' : 'Quiet';
    crowdLabel.textContent = crowdLevel;
    crowdLabel.style.color = predColor;
}

function updateDisplay() { updatePredictionDisplay(); }

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
    const days = parseInt(timeRange.value);
    try {
        const snapshot = await get(ref(db, 'Customers'));
        if (!snapshot.exists()) { showEmptyState(); return; }

        const members = [];
        const hourlyCount = Array(24).fill(0);

        snapshot.forEach(child => {
            const data = child.val();
            if (child.key.startsWith('WALKIN_')) return;
            const member = normalizeMemberData(child.key, data);
            members.push(member);

            member.attendance_history.forEach(visit => {
                if (visit.checkin) {
                    try { hourlyCount[new Date(visit.checkin).getHours()]++; } catch (e) {}
                }
            });
        });

        forecaster.buildPatterns(members, 90);
        processAnalytics(members, days, hourlyCount);
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
                    backgroundColor: 'rgba(235,192,105,0.7)',
                    borderColor: '#ebc069',
                    borderWidth: 1,
                    borderRadius: 6,
                    stack: 'rev'
                },
                {
                    label: 'Walk-in Fees',
                    data: walkinRevenue.map(v => Math.round(v)),
                    backgroundColor: 'rgba(79,195,247,0.7)',
                    borderColor: '#4fc3f7',
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
                    backgroundColor: '#282828',
                    titleColor: '#fff',
                    bodyColor: '#b3b3b3',
                    borderColor: '#383838',
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

function processAnalytics(members, days, hourlyCount) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const allVisits = [];
    const memberStats = {};
    const dailyCount = Array(7).fill(0);
    const dateCount = {};
    const stayTimes = [];

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
                if (visitDate < startDate || visitDate > endDate) return;
                const day = visitDate.getDay();
                const dateStr = visitDate.toISOString().split('T')[0];
                dailyCount[day]++;
                dateCount[dateStr] = (dateCount[dateStr] || 0) + 1;
                if (visit.time_spent) stayTimes.push(visit.time_spent);
                allVisits.push({ member, visit, hour: visitDate.getHours(), day, date: dateStr });
            } catch (e) {}
        });
    });

    updateSummaryCards(allVisits, dateCount, stayTimes, days, hourlyCount, dailyCount);
    updateCharts(hourlyCount, dailyCount, dateCount, members, allVisits);
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

function updateCharts(hourlyCount, dailyCount, dateCount, members, visits) {
    updateHourlyTrafficChart(hourlyCount, members);
    updateDailyTrafficChart(dateCount);
    updateMembershipActivityChart(members, visits);
}

function updateHourlyChartPrediction() {
    if (!hourlyTrafficChart) return;
    const prediction = forecaster.getPrediction();
    const nextHourIndex = (new Date().getHours() + 1) % 24;
    if (hourlyTrafficChart.data.datasets[1]) {
        const predictionData = Array(24).fill(null);
        predictionData[nextHourIndex] = prediction.prediction;
        hourlyTrafficChart.data.datasets[1].data = predictionData;
        hourlyTrafficChart.update('none');
    }
}

function updateHourlyTrafficChart(hourlyCount, members = []) {
    const ctx = document.getElementById('hourlyTrafficChart').getContext('2d');
    if (hourlyTrafficChart) hourlyTrafficChart.destroy();

    const labels = Array.from({ length: 12 }, (_, i) => i === 0 ? '12AM' : `${i}AM`)
        .concat(Array.from({ length: 12 }, (_, i) => i === 0 ? '12PM' : `${i}PM`));

    const prediction = forecaster.getPrediction(hourlyCount, members);
    const nextHourIndex = (new Date().getHours() + 1) % 24;
    const predictionData = Array(24).fill(null);
    predictionData[nextHourIndex] = prediction.prediction;

    const predColor = prediction.prediction >= 30 ? '#f15e6c' : prediction.prediction >= 15 ? '#ebc069' : '#1db954';

    hourlyTrafficChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Historical Visits',
                    data: hourlyCount,
                    backgroundColor: 'rgba(235,192,105,0.5)',
                    borderColor: '#ebc069',
                    borderWidth: 1,
                    borderRadius: 4,
                    barPercentage: 0.8
                },
                {
                    label: `AI Forecast: ${prediction.prediction}`,
                    data: predictionData,
                    type: 'line',
                    borderColor: predColor,
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointBackgroundColor: predColor,
                    pointBorderColor: '#121212',
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
                    backgroundColor: '#282828',
                    titleColor: '#fff',
                    bodyColor: '#b3b3b3',
                    borderColor: '#383838',
                    borderWidth: 1,
                    cornerRadius: 8,
                    callbacks: {
                        label: ctx => `${ctx.parsed.y !== null ? ctx.parsed.y : 0} visitors`,
                        afterLabel: ctx => ctx.datasetIndex === 1 ? `Confidence: ${Math.round(prediction.confidence * 100)}%` : undefined
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: colors.lightGray, drawBorder: false },
                    ticks: { color: colors.darkGray, font: { size: 11 }, callback: v => Number.isInteger(v) ? v : '' },
                    title: { display: true, text: 'Visitors', color: colors.darkGray }
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
    const ctx = document.getElementById('dailyTrafficChart').getContext('2d');
    if (dailyTrafficChart) dailyTrafficChart.destroy();

    const dates = Object.keys(dateCount).sort();
    const values = dates.map(d => dateCount[d]);
    const formattedDates = dates.map(d => { const dt = new Date(d); return `${dt.getMonth() + 1}/${dt.getDate()}`; });

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(235,192,105,0.3)');
    gradient.addColorStop(1, 'rgba(235,192,105,0.02)');

    dailyTrafficChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: formattedDates,
            datasets: [{
                label: 'Daily Traffic',
                data: values,
                backgroundColor: gradient,
                borderColor: '#ebc069',
                borderWidth: 2,
                tension: 0.3,
                fill: true,
                pointBackgroundColor: '#ebc069',
                pointBorderColor: '#121212',
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
                    backgroundColor: '#282828',
                    titleColor: '#fff',
                    bodyColor: '#b3b3b3',
                    borderColor: '#383838',
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
                backgroundColor: ['#1db954', '#ebc069', '#f15e6c'],
                borderColor: '#121212',
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
                    backgroundColor: '#282828',
                    titleColor: '#fff',
                    bodyColor: '#b3b3b3',
                    borderColor: '#383838',
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
        '<div class="stat-item" style="color:#6a6a6a">No visits recorded</div>';

    const fmtHour = h => h === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`;
    const peakHoursSorted = hourlyCount.map((count, hour) => ({ hour, count })).filter(h => h.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);

    peakHoursList.innerHTML = peakHoursSorted.length > 0 ?
        peakHoursSorted.map(({ hour, count }) => `<div class="stat-item"><span>${fmtHour(hour)}</span><span class="value">${count} check-ins</span></div>`).join('') :
        '<div class="stat-item" style="color:#6a6a6a">No check-in data</div>';

    const activeCount = members.filter(m => m.membership.status !== 'expired' && (m.membership.remaining_days === undefined || m.membership.remaining_days > 0)).length;
    const expiredCount = members.filter(m => m.membership.status === 'expired' || (m.membership.remaining_days !== undefined && m.membership.remaining_days <= 0)).length;

    membershipStats.innerHTML = `
        <div class="stat-item"><span>Active Members</span><span class="value" style="color:#1db954">${activeCount}</span></div>
        <div class="stat-item"><span>Expired Members</span><span class="value" style="color:#f15e6c">${expiredCount}</span></div>
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
        membership: data.membership || { status: 'active', remaining_days: 30 },
        gym_data,
        attendance_history
    };
}

function getActualRemainingDays(member) {
    const m = member.membership || {};
    if (m.status === 'expired') return 0;

    if (!m.end_date) {
        if (m.start_date && m.months_paid) {
            const start = new Date(m.start_date);
            const end   = new Date(start);
            end.setMonth(end.getMonth() + (m.months_paid || 1));
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return Math.max(0, Math.ceil((end - today) / (1000 * 60 * 60 * 24)));
        }
        return m.remaining_days || 0;
    }

    try {
        const endDate = new Date(m.end_date);
        const today   = new Date();
        today.setHours(0, 0, 0, 0);
        return Math.max(0, Math.ceil((endDate - today) / (1000 * 60 * 60 * 24)));
    } catch (e) {
        return m.remaining_days || 0;
    }
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

    topMembersList.innerHTML = '<div class="stat-item" style="color:#6a6a6a">No data available</div>';
    peakHoursList.innerHTML = '<div class="stat-item" style="color:#6a6a6a">No data available</div>';
    membershipStats.innerHTML = '<div class="stat-item" style="color:#6a6a6a">No data available</div>';

    updateHourlyTrafficChart(Array(24).fill(0), []);
    updateDailyTrafficChart({});
    updateMembershipActivityChart([], []);
}

document.addEventListener('DOMContentLoaded', init);
