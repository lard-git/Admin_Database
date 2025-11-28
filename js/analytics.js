import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getDatabase, ref, onValue, get } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyB6x0Si8OoiD3UDDMjXgZTMOdfv8neMtik",
    authDomain: "gym-database-f4b61.firebaseapp.com",
    databaseURL: "https://gym-database-f4b61-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "gym-database-f4b61",
    storageBucket: "gym-database-f4b61.firebasestorage.app",
    messagingSenderId: "79575587778",
    appId: "1:79575587778:web:55b218534fde16847ad45b",
    measurementId: "G-BGPJNP62J5"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// DOM Elements
const timeRange = document.getElementById('timeRange');
const avgDailyVisitors = document.getElementById('avgDailyVisitors');
const peakHour = document.getElementById('peakHour');
const busiestDay = document.getElementById('busiestDay');
const avgStayTime = document.getElementById('avgStayTime');
const topMembersList = document.getElementById('topMembersList');
const peakHoursList = document.getElementById('peakHoursList');
const membershipStats = document.getElementById('membershipStats');

// Charts
let hourlyTrafficChart, dailyTrafficChart, membershipActivityChart;

// Initialize
function init() {
    loadAnalyticsData();
    
    timeRange.addEventListener('change', loadAnalyticsData);
}

// Load and process analytics data
async function loadAnalyticsData() {
    const days = parseInt(timeRange.value);
    const membersRef = ref(db, 'Customers');
    
    try {
        const snapshot = await get(membersRef);
        if (!snapshot.exists()) {
            console.log('No data found');
            showEmptyState();
            return;
        }

        const members = [];
        snapshot.forEach(child => {
            const data = child.val();
            const member = normalizeMemberData(child.key, data);
            members.push(member);
        });

        console.log('Processed members:', members);
        processAnalytics(members, days);
    } catch (error) {
        console.error('Error loading analytics:', error);
        showEmptyState();
    }
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

// Process analytics data
function processAnalytics(members, days) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const allVisits = [];
    const memberStats = {};
    const hourlyCount = Array(24).fill(0);
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

                const hour = visitDate.getHours();
                const day = visitDate.getDay();
                const dateStr = visitDate.toISOString().split('T')[0];

                hourlyCount[hour]++;
                dailyCount[day]++;
                dateCount[dateStr] = (dateCount[dateStr] || 0) + 1;

                if (visit.time_spent) {
                    stayTimes.push(visit.time_spent);
                }

                allVisits.push({
                    member: member,
                    visit: visit,
                    hour: hour,
                    day: day,
                    date: dateStr
                });
            } catch (e) {
                console.log('Error processing visit:', visit, e);
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
    
    // Format peak hour with AM/PM
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

// Hourly Traffic Chart
// Hourly Traffic Chart
function updateHourlyTrafficChart(hourlyCount) {
    const ctx = document.getElementById('hourlyTrafficChart').getContext('2d');
    
    if (hourlyTrafficChart) {
        hourlyTrafficChart.destroy();
    }

    // Create AM/PM labels
    const labels = Array.from({length: 24}, (_, i) => {
        if (i === 0) return '12 AM';
        if (i === 12) return '12 PM';
        if (i < 12) return `${i} AM`;
        return `${i - 12} PM`;
    });

    const totalVisits = hourlyCount.reduce((a, b) => a + b, 0);
    if (totalVisits === 0) {
        hourlyTrafficChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'No data available',
                    data: Array(24).fill(0),
                    backgroundColor: '#e9ecef',
                    borderColor: '#6c757d',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Number of Check-ins'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Time of Day'
                        },
                        ticks: {
                            maxRotation: 45,
                            minRotation: 45
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    title: {
                        display: true,
                        text: 'No check-in data available',
                        position: 'bottom'
                    }
                }
            }
        });
        return;
    }

    hourlyTrafficChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Check-ins',
                data: hourlyCount,
                backgroundColor: '#9b4de4d3',
                borderColor: '#7a37c4',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Number of Check-ins'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Time of Day'
                    },
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45
                    }
                }
            }
        }
    });
}
// Daily Traffic Chart
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

    if (dates.length === 0) {
        dailyTrafficChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['No data'],
                datasets: [{
                    label: 'No data available',
                    data: [0],
                    backgroundColor: 'rgba(108, 117, 125, 0.1)',
                    borderColor: '#6c757d',
                    borderWidth: 2,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    title: {
                        display: true,
                        text: 'No daily data available',
                        position: 'bottom'
                    }
                }
            }
        });
        return;
    }

    dailyTrafficChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: formattedDates,
            datasets: [{
                label: 'Daily Visitors',
                data: values,
                backgroundColor: 'rgba(155, 77, 228, 0.1)',
                borderColor: '#9b4de4d3',
                borderWidth: 2,
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Number of Visitors'
                    }
                }
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

    if (members.length === 0) {
        membershipActivityChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['No members'],
                datasets: [{
                    data: [1],
                    backgroundColor: ['#e9ecef']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    title: {
                        display: true,
                        text: 'No member data available',
                        position: 'bottom'
                    }
                }
            }
        });
        return;
    }

    membershipActivityChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Active (Visited)', 'Active (Not Visited)', 'Expired'],
            datasets: [{
                data: [
                    activeVisitors.size,
                    activeMembers - activeVisitors.size,
                    expiredMembers
                ],
                backgroundColor: [
                    '#28a745',
                    '#17a2b8',
                    '#dc3545'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                }
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
        '<div class="stat-item">No visits recorded in selected period</div>';

    // Peak hours analysis with AM/PM format
    const peakHours = hourlyCount
        .map((count, hour) => ({ hour, count }))
        .filter(h => h.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    peakHoursList.innerHTML = peakHours.length > 0 ? 
        peakHours.map(({ hour, count }) => {
            // Format hour with AM/PM
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
        '<div class="stat-item">No check-in data available</div>';

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

// Show empty state when no data
function showEmptyState() {
    avgDailyVisitors.textContent = '0';
    peakHour.textContent = '--:--';
    busiestDay.textContent = '--';
    avgStayTime.textContent = '0m';
    
    topMembersList.innerHTML = '<div class="stat-item">No data available</div>';
    peakHoursList.innerHTML = '<div class="stat-item">No data available</div>';
    membershipStats.innerHTML = '<div class="stat-item">No data available</div>';
    
    // Initialize empty charts
    updateHourlyTrafficChart(Array(24).fill(0));
    updateDailyTrafficChart({});
    updateMembershipActivityChart([], []);
}

// Initialize the analytics dashboard
init();