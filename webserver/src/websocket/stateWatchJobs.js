/** The one set of state watches, shared by the portal's internal routes and the readers' route. */
const relayManager = require('./relayManager');
const { StateWatchJobs } = require('./stateWatch');

module.exports = new StateWatchJobs(relayManager);
