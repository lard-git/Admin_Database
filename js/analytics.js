import { db } from './database_init.js';
import { ref, get, onValue } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";
import { getCurrentMonthKey, getPreviousMonthKeys, getMonthlyRevenue } from './database_init.js';

// DOM Elements
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

// Charts
let hourlyTrafficChart, dailyTrafficChart, membershipActivityChart, revenueChart;

const colors = {
    primary: '#4A6FA5',
    secondary: '#6B8E23',
    accent: '#D4A76A',
    highlight: '#FF6B6B',
    lightGray: '#F5F7FA',
    darkGray: '#6C757D'
};

const historicalCache = {
    hourlyPatterns: {},
    dailyTotals: [],
    lastUpdated: null
};

class EnhancedForecaster {
    constructor() {
        this.currentPrediction = { prediction: 0, confidence: 0, factors: [] };
        this.lastUpdate = null;
        this.historicalData = [];
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
            member.attendance_history.forEach(visit => {
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
                if (age < 5) {
                    confidence = Math.min(0.95, confidence + 0.1);
                    factors.push('fresh data');
                } else if (age < 30) {
                    factors.push('recent data');
                }
            }

            this.currentPrediction = {
                prediction: Math.round(data.nextHour),
                confidence: confidence,
                timestamp: new Date(data.timestamp || new Date()),
                factors: factors,
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
        const momentum = recentHours[0] > recentHours[1] ? 'rising' : 
                        recentHours[0] < recentHours[1] ? 'falling' : 'stable';
        const momentumAvg = recentHours.reduce((a,b) => a+b, 0) / 3;
        if (momentumAvg > 0) factors.push(`${momentum} trend`);
        
        const yesterdaySameHour = patterns[(dayOfWeek + 6) % 7]?.[nextHour] || 0;
        if (yesterdaySameHour > 0) factors.push('yesterday comparison');
        
        const currentBaseline = hourlyData[currentHour] || 0;
        
        const prediction = Math.round(
            historicalAvg * 0.4 +
            momentumAvg * 0.3 +
            yesterdaySameHour * 0.2 +
            currentBaseline * 0.1
        );
        
        let confidence = 0.3;
        if (historicalAvg > 0) confidence += 0.25;
        if (momentumAvg > 0) confidence += 0.2;
        if (yesterdaySameHour > 0) confidence += 0.15;
        if (currentBaseline > 0) confidence += 0.1;
        
        return {
            prediction: Math.max(3, Math.min(50, prediction)),
            confidence: Math.min(0.95, confidence),
            timestamp: now,
            factors: factors,
            trend: momentum
        };
    }

    getPrediction(hourlyData = [], members = []) {
        if (this.lastUpdate) {
            const now = new Date();
            const minutesSinceUpdate = (now - this.lastUpdate) / (1000 * 60);
            
            if (minutesSinceUpdate < 2) {
                return this.currentPrediction;
            }
        }
        
        return this.calculateEnhancedPrediction(hourlyData, members);
    }
}

const forecaster = new EnhancedForecaster();

function init() {
    setupFirebaseListeners();
    loadAnalyticsData();
    
    timeRange.addEventListener('change', () => {
        loadAnalyticsData();
        loadRevenueHistory();
    });
    setInterval(updateDisplay, 60000);
}

function setupFirebaseListeners() {
    onValue(ref(db, 'Trend24h'), snap => {
        const data = snap.val();
        if (data && forecaster.setPredictionFromFirebase(data)) {
            updatePredictionDisplay();
            if (hourlyTrafficChart) {
                setTimeout(() => updateHourlyChartPrediction(), 100);
            }
        }
    });
    
    onValue(ref(db, 'WeeklyGrowthRate'), s => {
        const data = s.val();
        if (data && data.pct !== undefined) {
            updateGrowthDisplay(data);
        }
    });
    
    onValue(ref(db, 'HistoricalStats'), s => {
        const data = s.val();
        if (data) {
            historicalCache.lastUpdated = new Date();
        }
    });
}

function updateGrowthDisplay(data) {
    const pct = data.pct ?? 0;
    const previousPct = data.previousPct ?? 0;
    const trend = data.trend || (pct > previousPct ? 'up' : pct < previousPct ? 'down' : 'stable');
    
    const sign = pct > 0 ? '+' : '';
    growthText.textContent = `${sign}${pct}%`;
    
    if (pct >= 15) {
        growthText.style.color = '#28a745';
        growthText.style.fontWeight = 'bold';
    } else if (pct > 0) {
        growthText.style.color = '#5cb85c';
        growthText.style.fontWeight = 'normal';
    } else if (pct === 0) {
        growthText.style.color = '#6c757d';
        growthText.style.fontWeight = 'normal';
    } else if (pct > -10) {
        growthText.style.color = '#ffc107';
        growthText.style.fontWeight = 'normal';
    } else {
        growthText.style.color = '#dc3545';
        growthText.style.fontWeight = 'bold';
    }
    
    let trendEl = document.getElementById('growthTrend');
    if (!trendEl) {
        trendEl = document.createElement('div');
        trendEl.id = 'growthTrend';
        trendEl.style.cssText = 'font-size: 24px; margin-top: 5px;';
        growthText.parentNode.appendChild(trendEl);
    }
    
    const arrows = { 'up': '↑', 'down': '↓', 'stable': '→' };
    
    const labels = {
        'excellent': pct >= 15 ? 'Excellent 📈' : '',
        'good': (pct >= 5 && pct < 15) ? 'Good' : '',
        'stable': (pct >= -5 && pct < 5) ? 'Stable' : '',
        'attention': pct < -5 ? 'Needs Attention ⚠️' : ''
    };
    
    const label = labels.excellent || labels.good || labels.stable || labels.attention;
    const arrow = arrows[trend] || '→';
    
    trendEl.innerHTML = `${arrow} <small style="font-size:12px;color:#666;">${label}</small>`;
}

function updatePredictionDisplay() {
    const prediction = forecaster.getPrediction();
    
    aiNextHour.textContent = prediction.prediction;
    
    if (prediction.prediction >= 30) {
        aiNextHour.style.color = '#dc3545';
    } else if (prediction.prediction >= 15) {
        aiNextHour.style.color = '#ffc107';
    } else {
        aiNextHour.style.color = '#28a745';
    }
    
    const confidencePct = Math.round(prediction.confidence * 100);
    const confidenceColor = confidencePct > 70 ? '#28a745' : 
                           confidencePct > 40 ? '#ffc107' : '#dc3545';
    
    let confidenceBar = document.getElementById('confidenceBar');
    if (!confidenceBar) {
        confidenceBar = document.createElement('div');
        confidenceBar.id = 'confidenceBar';
        confidenceBar.style.cssText = `
            width: 100%;
            height: 4px;
            background: #e9ecef;
            border-radius: 2px;
            margin-top: 8px;
            overflow: hidden;
        `;
        const fill = document.createElement('div');
        fill.id = 'confidenceFill';
        fill.style.cssText = `
            height: 100%;
            width: 0%;
            transition: width 0.5s ease, background-color 0.3s ease;
        `;
        confidenceBar.appendChild(fill);
        aiConfidence.parentNode.insertBefore(confidenceBar, aiConfidence.nextSibling);
    }
    
    const fill = document.getElementById('confidenceFill');
    fill.style.width = `${confidencePct}%`;
    fill.style.backgroundColor = confidenceColor;
    
    let factorText = '';
    if (prediction.factors && prediction.factors.length > 0) {
        factorText = ` • Based on: ${prediction.factors.slice(0, 2).join(', ')}`;
    }
    
    aiConfidence.textContent = `${confidencePct}% confidence${factorText}`;
    aiConfidence.style.color = confidenceColor;
    aiConfidence.style.fontWeight = confidencePct > 70 ? 'bold' : 'normal';
    
    let crowdLabel = document.getElementById('crowdLabel');
    if (!crowdLabel) {
        crowdLabel = document.createElement('div');
        crowdLabel.id = 'crowdLabel';
        crowdLabel.style.cssText = `
            font-size: 12px;
            margin-top: 5px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        `;
        aiNextHour.parentNode.appendChild(crowdLabel);
    }
    
    const crowdLevel = prediction.prediction >= 30 ? 'Very Busy' : 
                      prediction.prediction >= 20 ? 'Busy' :
                      prediction.prediction >= 10 ? 'Moderate' : 'Quiet';
    crowdLabel.textContent = crowdLevel;
    crowdLabel.style.color = aiNextHour.style.color;
}

function updateDisplay() {
    updatePredictionDisplay();
}

async function loadAnalyticsData() {
    const days = parseInt(timeRange.value);
    const membersRef = ref(db, 'Customers');
    
    try {
        const snapshot = await get(membersRef);
        if (!snapshot.exists()) {
            showEmptyState();
            return;
        }

        const members = [];
        const hourlyCount = Array(24).fill(0);
        
        snapshot.forEach(child => {
            const data = child.val();
            const member = normalizeMemberData(child.key, data);
            members.push(member);
            
            member.attendance_history.forEach(visit => {
                if (visit.checkin) {
                    try {
                        const hour = new Date(visit.checkin).getHours();
                        hourlyCount[hour]++;
                    } catch (e) {}
                }
            });
        });

        forecaster.buildPatterns(members, days);
        processAnalytics(members, days, hourlyCount);
        loadRevenueHistory();
        
    } catch (error) {
        console.error('Error loading analytics:', error);
        showEmptyState();
    }
}

async function loadRevenueHistory() {
    // Get last 12 months revenue
    const months = getPreviousMonthKeys(12);
    const currentMonth = getCurrentMonthKey();
    months.unshift(currentMonth);
    
    const revenueData = [];
    const labels = [];
    
    for (const month of months) {
        const data = await getMonthlyRevenue(month);
        revenueData.push(data.total || 0);
        
        // Format label (e.g., "Jan 2024")
        const [year, monthNum] = month.split('-');
        const date = new Date(parseInt(year), parseInt(monthNum) - 1, 1);
        labels.push(date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
    }
    
    updateRevenueChart(labels, revenueData);
}

function updateRevenueChart(labels, revenueData) {
    const ctx = document.getElementById('revenueHistoryChart');
    if (!ctx) {
        // Create revenue chart container if it doesn't exist
        addRevenueChartToDOM();
        return;
    }
    
    if (revenueChart) {
        revenueChart.destroy();
    }
    
    const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(107, 142, 35, 0.3)');
    gradient.addColorStop(1, 'rgba(107, 142, 35, 0.05)');
    
    revenueChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Monthly Revenue (₱)',
                data: revenueData,
                backgroundColor: gradient,
                borderColor: colors.secondary,
                borderWidth: 3,
                tension: 0.2,
                fill: true,
                pointBackgroundColor: colors.secondary,
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: { color: colors.darkGray }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `₱${context.parsed.y.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return '₱' + value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
}

function addRevenueChartToDOM() {
    // Find the charts grid and add revenue chart
    const chartsGrid = document.querySelector('.charts-grid');
    if (chartsGrid && !document.getElementById('revenueHistoryChart')) {
        const revenueCard = document.createElement('div');
        revenueCard.className = 'chart-card';
        revenueCard.style.flex = '1 1 100%';
        revenueCard.innerHTML = `
            <h3>Monthly Revenue History (₱)</h3>
            <div class="chart-container" style="height: 300px;">
                <canvas id="revenueHistoryChart"></canvas>
            </div>
        `;
        chartsGrid.appendChild(revenueCard);
    }
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
            } catch (e) {
                return false;
            }
        }).length;

        memberStats[member.uid] = {
            name: `${member.firstname} ${member.lastname}`,
            visits: memberVisits,
            membership: member.membership
        };

        member.attendance_history.forEach(visit => {
            if (!visit.checkin) return;
            
            try {
                const visitDate = new Date(visit.checkin);
                if (visitDate < startDate || visitDate > endDate) return;

                const day = visitDate.getDay();
                const dateStr = visitDate.toISOString().split('T')[0];

                dailyCount[day]++;
                dateCount[dateStr] = (dateCount[dateStr] || 0) + 1;

                if (visit.time_spent) {
                    stayTimes.push(visit.time_spent);
                }

                allVisits.push({
                    member: member,
                    visit: visit,
                    hour: visitDate.getHours(),
                    day: day,
                    date: dateStr
                });
            } catch (e) {}
        });
    });

    updateSummaryCards(allVisits, dateCount, stayTimes, days, hourlyCount, dailyCount);
    updateCharts(hourlyCount, dailyCount, dateCount, members, allVisits);
    updateDetailedStats(memberStats, hourlyCount, members);
}

function updateSummaryCards(visits, dateCount, stayTimes, days, hourlyCount, dailyCount) {
    const uniqueDates = Object.keys(dateCount).length;
    const avgVisitors = uniqueDates > 0 ? 
        (visits.length / Math.min(uniqueDates, days)).toFixed(1) : '0';
    avgDailyVisitors.textContent = avgVisitors;

    let maxHour = 0;
    let maxCount = 0;
    for (let i = 0; i < 24; i++) {
        if (hourlyCount[i] > maxCount) {
            maxCount = hourlyCount[i];
            maxHour = i;
        }
    }
    
    let peakHourFormatted;
    if (maxHour === 0) {
        peakHourFormatted = '12 AM';
    } else if (maxHour === 12) {
        peakHourFormatted = '12 PM';
    } else if (maxHour < 12) {
        peakHourFormatted = `${maxHour} AM`;
    } else {
        peakHourFormatted = `${maxHour - 12} PM`;
    }
    
    peakHour.textContent = maxCount > 0 ? peakHourFormatted : '--:--';

    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    let busiestDayIndex = dailyCount.indexOf(Math.max(...dailyCount));
    busiestDay.textContent = maxCount > 0 ? daysOfWeek[busiestDayIndex] : '--';

    const avgStay = stayTimes.length > 0 ? 
        Math.round(stayTimes.reduce((a, b) => a + b, 0) / stayTimes.length) : 0;
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
    const now = new Date();
    const nextHourIndex = (now.getHours() + 1) % 24;
    
    if (hourlyTrafficChart.data.datasets[1]) {
        const predictionData = Array(24).fill(null);
        predictionData[nextHourIndex] = prediction.prediction;
        hourlyTrafficChart.data.datasets[1].data = predictionData;
        
        const crowdLevel = prediction.prediction >= 30 ? '🔴 Busy' : 
                          prediction.prediction >= 15 ? '🟡 Moderate' : '🟢 Quiet';
        hourlyTrafficChart.data.datasets[1].label = `Next Hour: ${prediction.prediction} (${crowdLevel})`;
        hourlyTrafficChart.update('none');
    }
}

function updateHourlyTrafficChart(hourlyCount, members = []) {
    const ctx = document.getElementById('hourlyTrafficChart').getContext('2d');
    
    if (hourlyTrafficChart) {
        hourlyTrafficChart.destroy();
    }

    const labels = Array.from({length: 12}, (_, i) => {
        if (i === 0) return '12AM';
        return `${i}AM`;
    }).concat(Array.from({length: 12}, (_, i) => {
        if (i === 0) return '12PM';
        return `${i}PM`;
    }));

    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, colors.primary);
    gradient.addColorStop(1, '#8FB8ED');

    const prediction = forecaster.getPrediction(hourlyCount, members);
    const now = new Date();
    const nextHourIndex = (now.getHours() + 1) % 24;
    
    const predictionData = Array(24).fill(null);
    predictionData[nextHourIndex] = prediction.prediction;

    const predictionColor = prediction.prediction >= 30 ? '#dc3545' : 
                           prediction.prediction >= 15 ? '#ffc107' : '#28a745';

    hourlyTrafficChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Historical Visits',
                    data: hourlyCount,
                    backgroundColor: gradient,
                    borderColor: colors.primary,
                    borderWidth: 1,
                    borderRadius: 4,
                    barPercentage: 0.8
                },
                {
                    label: `AI Prediction: ${prediction.prediction}`,
                    data: predictionData,
                    type: 'line',
                    borderColor: predictionColor,
                    borderWidth: 3,
                    borderDash: [5, 5],
                    pointBackgroundColor: predictionColor,
                    pointBorderColor: '#ffffff',
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
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: colors.darkGray,
                        font: { size: 12 },
                        usePointStyle: true
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: colors.darkGray,
                    bodyColor: colors.darkGray,
                    borderColor: colors.lightGray,
                    borderWidth: 1,
                    cornerRadius: 6
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: colors.lightGray, drawBorder: false },
                    ticks: { color: colors.darkGray, font: { size: 11 } }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: colors.darkGray, font: { size: 11 }, maxRotation: 0 }
                }
            }
        }
    });
}

function updateDailyTrafficChart(dateCount) {
    const ctx = document.getElementById('dailyTrafficChart').getContext('2d');
    
    if (dailyTrafficChart) {
        dailyTrafficChart.destroy();
    }

    const dates = Object.keys(dateCount).sort();
    const values = dates.map(date => dateCount[date]);

    const formattedDates = dates.map(date => {
        const d = new Date(date);
        return `${d.getMonth() + 1}/${d.getDate()}`;
    });

    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(74, 111, 165, 0.2)');
    gradient.addColorStop(1, 'rgba(74, 111, 165, 0.05)');

    dailyTrafficChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: formattedDates,
            datasets: [{
                label: 'Daily Traffic',
                data: values,
                backgroundColor: gradient,
                borderColor: colors.primary,
                borderWidth: 3,
                tension: 0.2,
                fill: true,
                pointBackgroundColor: colors.primary,
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: colors.darkGray,
                    bodyColor: colors.darkGray,
                    borderColor: colors.lightGray,
                    borderWidth: 1,
                    cornerRadius: 6,
                    displayColors: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: colors.lightGray, drawBorder: false },
                    ticks: { color: colors.darkGray, font: { size: 11 } }
                },
                x: {
                    grid: { color: colors.lightGray, drawBorder: false },
                    ticks: { color: colors.darkGray, font: { size: 11 }, maxRotation: 45 }
                }
            }
        }
    });
}

function updateMembershipActivityChart(members, visits) {
    const ctx = document.getElementById('membershipActivityChart').getContext('2d');
    
    if (membershipActivityChart) {
        membershipActivityChart.destroy();
    }

    const activeMembers = members.filter(m => 
        m.membership.status !== 'expired' && 
        (m.membership.remaining_days === undefined || m.membership.remaining_days > 0)
    ).length;

    const expiredMembers = members.filter(m => 
        m.membership.status === 'expired' || 
        (m.membership.remaining_days !== undefined && m.membership.remaining_days <= 0)
    ).length;

    const activeVisitors = new Set();
    visits.forEach(visit => {
        const member = visit.member;
        if (member.membership.status !== 'expired' && 
            (member.membership.remaining_days === undefined || member.membership.remaining_days > 0)) {
            activeVisitors.add(member.uid);
        }
    });

    const activeVisited = activeVisitors.size;
    const activeNotVisited = activeMembers - activeVisited;

    membershipActivityChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Active & Visiting', 'Active (Not Visiting)', 'Expired'],
            datasets: [{
                data: [activeVisited, activeNotVisited, expiredMembers],
                backgroundColor: [colors.secondary, colors.primary, colors.highlight],
                borderColor: '#ffffff',
                borderWidth: 2,
                hoverOffset: 15
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: colors.darkGray,
                        font: { size: 12 },
                        padding: 20,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: colors.darkGray,
                    bodyColor: colors.darkGray,
                    borderColor: colors.lightGray,
                    borderWidth: 1,
                    cornerRadius: 6,
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = Math.round((value / total) * 100);
                            return `${label}: ${value} members (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

function updateDetailedStats(memberStats, hourlyCount, members) {
    const topMembers = Object.values(memberStats)
        .filter(m => m.visits > 0)
        .sort((a, b) => b.visits - a.visits)
        .slice(0, 5);

    topMembersList.innerHTML = topMembers.length > 0 ? 
        topMembers.map(member => `
            <div class="stat-item">
                <span>${member.name}</span>
                <span class="value">${member.visits} visits</span>
            </div>
        `).join('') : 
        '<div class="stat-item">No visits recorded</div>';

    const peakHours = hourlyCount
        .map((count, hour) => ({ hour, count }))
        .filter(h => h.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    peakHoursList.innerHTML = peakHours.length > 0 ? 
        peakHours.map(({ hour, count }) => {
            let hourFormatted;
            if (hour === 0) {
                hourFormatted = '12 AM';
            } else if (hour === 12) {
                hourFormatted = '12 PM';
            } else if (hour < 12) {
                hourFormatted = `${hour} AM`;
            } else {
                hourFormatted = `${hour - 12} PM`;
            }
            
            return `
                <div class="stat-item">
                    <span>${hourFormatted}</span>
                    <span class="value">${count} check-ins</span>
                </div>
            `;
        }).join('') : 
        '<div class="stat-item">No check-in data</div>';

    const activeCount = members.filter(m => 
        m.membership.status !== 'expired' && 
        (m.membership.remaining_days === undefined || m.membership.remaining_days > 0)
    ).length;

    const expiredCount = members.filter(m => 
        m.membership.status === 'expired' || 
        (m.membership.remaining_days !== undefined && m.membership.remaining_days <= 0)
    ).length;

    membershipStats.innerHTML = `
        <div class="stat-item">
            <span>Active Members</span>
            <span class="value">${activeCount}</span>
        </div>
        <div class="stat-item">
            <span>Expired Members</span>
            <span class="value">${expiredCount}</span>
        </div>
        <div class="stat-item">
            <span>Total Members</span>
            <span class="value">${members.length}</span>
        </div>
    `;
}

function normalizeMemberData(key, data) {
    const uid = data.gym_data?.uid || 
                data.personal_info?.uid || 
                data.uid || 
                key;
    
    const firstname = data.personal_info?.firstname || '';
    const lastname = data.personal_info?.lastname || '';
    
    const gym_data = {
        is_checked_in: data.gym_data?.is_checked_in || false,
        last_checkin: data.gym_data?.last_checkin || null,
        last_checkout: data.gym_data?.last_checkout || null,
        total_visits: data.gym_data?.total_visits || 0,
        total_time_spent: data.gym_data?.total_time_spent || 0,
        uid: uid
    };
    
    const membership = data.membership || {
        status: 'active',
        remaining_days: 30,
        start_date: '',
        end_date: ''
    };
    
    let attendance_history = [];
    if (Array.isArray(data.attendance_history)) {
        attendance_history = data.attendance_history;
    } else if (data.attendance_history && typeof data.attendance_history === 'object') {
        attendance_history = Object.values(data.attendance_history);
    }
    
    if (gym_data.last_checkin && !attendance_history.some(visit => visit.checkin === gym_data.last_checkin)) {
        attendance_history.push({
            checkin: gym_data.last_checkin,
            checkout: gym_data.last_checkout,
            time_spent: null,
            date: gym_data.last_checkin ? new Date(gym_data.last_checkin).toISOString().split('T')[0] : null
        });
    }

    return {
        key: key,
        uid: uid,
        firstname: firstname,
        lastname: lastname,
        membership: membership,
        gym_data: gym_data,
        attendance_history: attendance_history
    };
}

function showEmptyState() {
    avgDailyVisitors.textContent = '0';
    peakHour.textContent = '--:--';
    busiestDay.textContent = '--';
    avgStayTime.textContent = '0m';
    aiNextHour.textContent = '—';
    aiConfidence.textContent = 'confidence —';
    growthText.textContent = '—';
    
    const trendEl = document.getElementById('growthTrend');
    if (trendEl) trendEl.innerHTML = '';
    
    const confidenceBar = document.getElementById('confidenceBar');
    if (confidenceBar) confidenceBar.style.display = 'none';
    
    const crowdLabel = document.getElementById('crowdLabel');
    if (crowdLabel) crowdLabel.textContent = '';
    
    topMembersList.innerHTML = '<div class="stat-item">No data available</div>';
    peakHoursList.innerHTML = '<div class="stat-item">No data available</div>';
    membershipStats.innerHTML = '<div class="stat-item">No data available</div>';
    
    updateHourlyTrafficChart(Array(24).fill(0), []);
    updateDailyTrafficChart({});
    updateMembershipActivityChart([], []);
}

init();