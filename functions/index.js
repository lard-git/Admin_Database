/* ----------  FIXED 7-DAY ROLLING GROWTH  ---------- */
exports.weeklyGrowth = functions.pubsub.schedule('5 0 * * *').onRun(async () => {
  console.log('=== WEEKLY GROWTH CALCULATION STARTED ===');
  
  const now = new Date();
  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(now.getDate() - 7);
  
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(thisWeekStart.getDate() - 7);

  console.log('Calculation Date Ranges:', {
    now: now.toISOString(),
    thisWeekStart: thisWeekStart.toISOString(),
    lastWeekStart: lastWeekStart.toISOString(),
    thisWeekEnd: now.toISOString(),
    lastWeekEnd: thisWeekStart.toISOString()
  });

  // Get all hourly data
  const hist = await admin.database()
    .ref('HourlyHistory')
    .orderByKey()
    .once('value');

  let thisWeekSum = 0;
  let lastWeekSum = 0;
  let thisWeekCount = 0;
  let lastWeekCount = 0;

  hist.forEach(s => {
    const data = s.val();
    const key = s.key; // Format: "2024-12-13-14" (YYYY-MM-DD-HH)
    
    // Parse the date from key - FIXED
    const [year, month, day, hour] = key.split('-').map(Number);
    
    if (!year || !month || !day || hour === undefined) {
      console.log('Skipping invalid key:', key);
      return;
    }
    
    // Create date in UTC to avoid timezone issues
    const dataDate = new Date(Date.UTC(year, month - 1, day, hour));
    
    // Debug specific dates
    const isThisWeek = dataDate >= thisWeekStart && dataDate < now;
    const isLastWeek = dataDate >= lastWeekStart && dataDate < thisWeekStart;
    
    if (isThisWeek) {
      thisWeekSum += data.count || 0;
      thisWeekCount++;
      console.log(`This Week: ${key} = ${data.count} (total: ${thisWeekSum})`);
    } else if (isLastWeek) {
      lastWeekSum += data.count || 0;
      lastWeekCount++;
      console.log(`Last Week: ${key} = ${data.count} (total: ${lastWeekSum})`);
    }
  });

  console.log('Final Results:', { 
    thisWeekSum, 
    lastWeekSum, 
    thisWeekCount, 
    lastWeekCount 
  });
  
  let growth = 0;
  if (lastWeekSum > 0) {
    growth = ((thisWeekSum - lastWeekSum) / lastWeekSum * 100);
  } else if (thisWeekSum > 0) {
    growth = 100; // Infinite growth from 0
  }
  
  console.log('Calculated growth:', growth.toFixed(1) + '%');
  console.log('This week avg:', (thisWeekSum / Math.max(1, thisWeekCount)).toFixed(1));
  console.log('Last week avg:', (lastWeekSum / Math.max(1, lastWeekCount)).toFixed(1));

  await admin.database().ref('WeeklyGrowthRate').set({
    pct: Number(growth.toFixed(1)),
    date: now.toISOString().split('T')[0],
    thisWeekSum: thisWeekSum,
    lastWeekSum: lastWeekSum,
    thisWeekCount: thisWeekCount,
    lastWeekCount: lastWeekCount,
    thisWeekAvg: thisWeekCount > 0 ? thisWeekSum / thisWeekCount : 0,
    lastWeekAvg: lastWeekCount > 0 ? lastWeekSum / lastWeekCount : 0,
    timestamp: now.toISOString()
  });
  
  return null;
});

/* ----------  MANUAL TEST FUNCTION  ---------- */
// Add this to manually trigger and test the growth calculation
exports.testWeeklyGrowth = functions.https.onRequest(async (req, res) => {
  console.log('=== MANUAL TEST STARTED ===');
  
  const now = new Date();
  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(now.getDate() - 7);
  
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(thisWeekStart.getDate() - 7);

  // Get all hourly data
  const hist = await admin.database()
    .ref('HourlyHistory')
    .orderByKey()
    .once('value');

  const hourlyData = [];
  let thisWeekSum = 0;
  let lastWeekSum = 0;

  hist.forEach(s => {
    const data = s.val();
    const key = s.key;
    const [year, month, day, hour] = key.split('-').map(Number);
    
    if (!year || !month || !day || hour === undefined) return;
    
    const dataDate = new Date(Date.UTC(year, month - 1, day, hour));
    const isThisWeek = dataDate >= thisWeekStart && dataDate < now;
    const isLastWeek = dataDate >= lastWeekStart && dataDate < thisWeekStart;
    
    hourlyData.push({
      key: key,
      count: data.count,
      date: dataDate.toISOString(),
      period: isThisWeek ? 'thisWeek' : (isLastWeek ? 'lastWeek' : 'older')
    });
    
    if (isThisWeek) thisWeekSum += data.count || 0;
    if (isLastWeek) lastWeekSum += data.count || 0;
  });

  const growth = lastWeekSum > 0 ? ((thisWeekSum - lastWeekSum) / lastWeekSum * 100).toFixed(1) : 
                (thisWeekSum > 0 ? '100.0' : '0.0');

  res.json({
    success: true,
    calculation: {
      thisWeekStart: thisWeekStart.toISOString(),
      lastWeekStart: lastWeekStart.toISOString(),
      now: now.toISOString(),
      thisWeekSum: thisWeekSum,
      lastWeekSum: lastWeekSum,
      growth: growth + '%'
    },
    sampleData: hourlyData.slice(0, 20), // First 20 entries
    totalEntries: hourlyData.length,
    dataByPeriod: {
      thisWeek: hourlyData.filter(d => d.period === 'thisWeek').length,
      lastWeek: hourlyData.filter(d => d.period === 'lastWeek').length,
      older: hourlyData.filter(d => d.period === 'older').length
    }
  });
});