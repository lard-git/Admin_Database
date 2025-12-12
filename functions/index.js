const functions = require('firebase-functions');
const admin       = require('firebase-admin');
admin.initializeApp();

/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const {setGlobalOptions} = require("firebase-functions");
const {onRequest} = require("firebase-functions/https");
const logger = require("firebase-functions/logger");

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

// 00:05 daily – after the hourly forecast
exports.weeklyGrowth = functions.pubsub.schedule('5 0 * * *')
  .onRun(async () => {
    const now = new Date();
    const thisWeekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);

    const thisSum = await sumHourly(thisWeekStart, now);
    const lastSum = await sumHourly(lastWeekStart, thisWeekStart);
    const growth = lastSum ? ((thisSum - lastSum) / lastSum * 100) : 0;

    await admin.database().ref('WeeklyGrowthRate').set({
      pct: Number(growth.toFixed(1)),
      date: now.toISOString().split('T')[0]
    });
  });

// helper – sums hourly counts between two Date objects
async function sumHourly(start, end) {
  const snap = await admin.database()
    .ref('HourlyHistory')
    .orderByKey()
    .startAt(start.toISOString().slice(0, 13))
    .endAt(end.toISOString().slice(0, 13))
    .once('value');
  let sum = 0;
  snap.forEach(s => sum += s.val().count);
  return sum;
}