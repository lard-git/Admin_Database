
import { db } from './database_init.js';
import { getDatabase, ref, set, get, update, remove, onValue } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

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
let hourlyTrafficChart, dailyTrafficChart, membershipActivityChart;

// Simple color scheme
const colors = {
    primary: '#4A6FA5',
    secondary: '#6B8E23',
    accent: '#D4A76A',
    highlight: '#FF6B6B',
    lightGray: '#F5F7FA',
    darkGray: '#6C757D'
};

// Simple forecaster that uses Firebase data
class SimpleFirebaseForecaster {
    constructor() {
        this.currentPrediction = { prediction: 0, confidence: 0 };
        this.lastUpdate = null;
    }

    // Set prediction from Firebase
    setPredictionFromFirebase(data) {
        if (data && data.nextHour !== undefined) {
            this.currentPrediction = {
                prediction: data.nextHour,
                confidence: data.confidence || 0.5,
                timestamp: new Date(data.timestamp || new Date())
            };
            this.lastUpdate = new Date();
            return true;
        }
        return false;
    }

    // Fallback prediction
    calculateFallbackPrediction(hourlyData) {
        if (hourlyData.length === 0) {
            return { prediction: 8, confidence: 0.1 };
        }
        
        const now = new Date();
        const currentHour = now.getHours();
        const nextHour = (currentHour + 1) % 24;
        
        // Simple prediction based on recent hours
        const recentHours = [nextHour, currentHour, (currentHour + 23) % 24];
        let sum = 0;
        let count = 0;
        
        recentHours.forEach(hour => {
            if (hourlyData[hour] > 0) {
                sum += hourlyData[hour];
                count++;
            }
        });
        
        const avg = count > 0 ? sum / count : 5;
        const prediction = Math.max(3, Math.min(25, Math.round(avg * 1.2)));
        
        return {
            prediction: prediction,
            confidence: 0.3 + (count / 3 * 0.3),
            timestamp: now
        };
    }

    // Get current prediction
    getPrediction(hourlyData = []) {
        // Use cached prediction if recent (< 2 minutes)
        if (this.lastUpdate) {
            const now = new Date();
            const minutesSinceUpdate = (now - this.lastUpdate) / (1000 * 60);
            
            if (minutesSinceUpdate < 2) {
                return this.currentPrediction;
            }
        }
        
        // Calculate fallback
        return this.calculateFallbackPrediction(hourlyData);
    }
}

// Initialize forecaster
const forecaster = new SimpleFirebaseForecaster();

// Initialize
function init() {
    // Set up Firebase listeners
    setupFirebaseListeners();
    
    // Load data
    loadAnalyticsData();
    
    timeRange.addEventListener('change', loadAnalyticsData);
    
    // Update display every 2 minutes
    setInterval(updateDisplay, 120000);
}

// Set up Firebase listeners
function setupFirebaseListeners() {
    // Listen for Trend24h (next hour prediction)
    onValue(ref(db, 'Trend24h'), snap => {
        const data = snap.val();
        if (data && forecaster.setPredictionFromFirebase(data)) {
            updatePredictionDisplay();
            if (hourlyTrafficChart) {
                setTimeout(() => updateHourlyChartPrediction(), 100);
            }
        }
    });
    
    // Listen for WeeklyGrowthRate
    onValue(ref(db, 'WeeklyGrowthRate'), s => {
        const data = s.val();
        if (data && data.pct !== undefined) {
            const pct = data.pct;
            growthText.textContent = (pct > 0 ? '+' : '') + pct + '%';
            growthText.style.color = pct > 0 ? '#28a745' : '#dc3545';
        }
    });
}

// Update prediction display
function updatePredictionDisplay() {
    const prediction = forecaster.getPrediction();
    
    aiNextHour.textContent = prediction.prediction;
    aiConfidence.textContent = `${Math.round(prediction.confidence * 100)}% confidence`;
    
    // Color code confidence
    if (prediction.confidence > 0.7) {
        aiConfidence.style.color = '#28a745';
        aiConfidence.style.fontWeight = 'bold';
    } else if (prediction.confidence > 0.4) {
        aiConfidence.style.color = '#ffc107';
        aiConfidence.style.fontWeight = 'bold';
    } else {
        aiConfidence.style.color = '#dc3545';
        aiConfidence.style.fontWeight = 'normal';
    }
}

// Update display
function updateDisplay() {
    updatePredictionDisplay();
}

// Load analytics data
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
            
            // Count hourly visits
            member.attendance_history.forEach(visit => {
                if (visit.checkin) {
                    try {
                        const hour = new Date(visit.checkin).getHours();
                        hourlyCount[hour]++;
                    } catch (e) {
                        // Skip error
                    }
                }
            });
        });

        // Process analytics
        processAnalytics(members, days, hourlyCount);
        
    } catch (error) {
        console.error('Error loading analytics:', error);
        showEmptyState();
    }
}

// Process analytics
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
            } catch (e) {
                // Skip error
            }
        });
    });

    updateSummaryCards(allVisits, dateCount, stayTimes, days, hourlyCount, dailyCount);
    updateCharts(hourlyCount, dailyCount, dateCount, members, allVisits);
    updateDetailedStats(memberStats, hourlyCount, members);
}

// Update summary cards
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

// Update charts
function updateCharts(hourlyCount, dailyCount, dateCount, members, visits) {
    updateHourlyTrafficChart(hourlyCount);
    updateDailyTrafficChart(dateCount);
    updateMembershipActivityChart(members, visits);
}

// Update hourly chart prediction line
function updateHourlyChartPrediction() {
    if (!hourlyTrafficChart) return;
    
    const prediction = forecaster.getPrediction();
    const now = new Date();
    const nextHourIndex = (now.getHours() + 1) % 24;
    
    if (hourlyTrafficChart.data.datasets[1]) {
        const predictionData = Array(24).fill(null);
        predictionData[nextHourIndex] = prediction.prediction;
        hourlyTrafficChart.data.datasets[1].data = predictionData;
        hourlyTrafficChart.data.datasets[1].label = `Next: ${prediction.prediction} visitors`;
        hourlyTrafficChart.update('none');
    }
}

// Hourly Chart with prediction
function updateHourlyTrafficChart(hourlyCount) {
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

    const prediction = forecaster.getPrediction(hourlyCount);
    const now = new Date();
    const nextHourIndex = (now.getHours() + 1) % 24;
    
    const predictionData = Array(24).fill(null);
    predictionData[nextHourIndex] = prediction.prediction;

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
                    label: `Next Hour: ${prediction.prediction}`,
                    data: predictionData,
                    type: 'line',
                    borderColor: colors.highlight,
                    borderWidth: 3,
                    borderDash: [5, 5],
                    pointBackgroundColor: colors.highlight,
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2,
                    pointRadius: 6,
                    pointHoverRadius: 8,
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
                        font: {
                            size: 12
                        }
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
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += `${context.parsed.y} visitors`;
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: colors.lightGray,
                        drawBorder: false
                    },
                    ticks: {
                        color: colors.darkGray,
                        font: {
                            size: 11
                        },
                        callback: function(value) {
                            return Number.isInteger(value) ? value : '';
                        }
                    },
                    title: {
                        display: true,
                        text: 'Visitors',
                        color: colors.darkGray,
                        font: {
                            size: 12,
                            weight: 'normal'
                        }
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: colors.darkGray,
                        font: {
                            size: 11
                        },
                        maxRotation: 0
                    },
                    title: {
                        display: true,
                        text: 'Time of Day',
                        color: colors.darkGray,
                        font: {
                            size: 12,
                            weight: 'normal'
                        }
                    }
                }
            },
            animation: {
                duration: 1000,
                easing: 'easeOutQuart'
            }
        }
    });
}

// Daily Chart
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
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: colors.darkGray,
                    bodyColor: colors.darkGray,
                    borderColor: colors.lightGray,
                    borderWidth: 1,
                    cornerRadius: 6,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return `${context.parsed.y} visitors`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: colors.lightGray,
                        drawBorder: false
                    },
                    ticks: {
                        color: colors.darkGray,
                        font: {
                            size: 11
                        }
                    },
                    title: {
                        display: true,
                        text: 'Visitors',
                        color: colors.darkGray,
                        font: {
                            size: 12,
                            weight: 'normal'
                        }
                    }
                },
                x: {
                    grid: {
                        color: colors.lightGray,
                        drawBorder: false
                    },
                    ticks: {
                        color: colors.darkGray,
                        font: {
                            size: 11
                        },
                        maxRotation: 45
                    },
                    title: {
                        display: true,
                        text: 'Date',
                        color: colors.darkGray,
                        font: {
                            size: 12,
                            weight: 'normal'
                        }
                    }
                }
            },
            animation: {
                duration: 1000,
                easing: 'easeOutQuart'
            }
        }
    });
}

// Membership Activity Chart
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
                backgroundColor: [
                    colors.secondary,
                    colors.primary,
                    colors.highlight
                ],
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
                        font: {
                            size: 12
                        },
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
            },
            animation: {
                animateScale: true,
                animateRotate: true,
                duration: 1000
            }
        }
    });
}

// Update detailed stats
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

// Normalize member data
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
        uid: parseInt(uid) || uid
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

// Show empty state
function showEmptyState() {
    avgDailyVisitors.textContent = '0';
    peakHour.textContent = '--:--';
    busiestDay.textContent = '--';
    avgStayTime.textContent = '0m';
    aiNextHour.textContent = '—';
    aiConfidence.textContent = 'confidence —';
    growthText.textContent = '—';
    
    topMembersList.innerHTML = '<div class="stat-item">No data available</div>';
    peakHoursList.innerHTML = '<div class="stat-item">No data available</div>';
    membershipStats.innerHTML = '<div class="stat-item">No data available</div>';
    
    updateHourlyTrafficChart(Array(24).fill(0));
    updateDailyTrafficChart({});
    updateMembershipActivityChart([], []);
}

// Initialize
init();
