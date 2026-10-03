/**
 * Readers following a live state watch (see websocket/stateWatch.js).
 *
 * Public, under /api/watch, because a reader is an MCP server or a pane, not
 * the portal; but it answers only a token the portal signed after checking the
 * key, for exactly this watch on exactly that home (utils/watchToken.js). A
 * read waits here, in Node, up to 25 s for a change: the portal is never the
 * one waiting.
 */
const express = require('express');
const config = require('../config/config');
const stateWatches = require('../websocket/stateWatchJobs');
const { MAX_WAIT_MS } = require('../websocket/stateWatch');
const watchToken = require('../utils/watchToken');

const router = express.Router();

router.get('/:jobId', async (req, res) => {
	const header = req.get('authorization') || '';
	const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
	const claim = watchToken.verify(config.relay.internalSecret, token);
	if (!claim || claim.jobId !== req.params.jobId) {
		return res.status(401).json({ error: 'A valid watch token for this watch is required.' });
	}
	const cursor = Number(req.query.cursor) || 0;
	const wait = Math.max(0, Math.min(MAX_WAIT_MS, (Number(req.query.wait) || 0) * 1000));
	const result = await stateWatches.read(claim.jobId, claim.serverId, cursor, wait);
	if (result === null) {
		return res.status(404).json({ error: 'Unknown or expired watch.' });
	}
	res.set('Cache-Control', 'no-store');
	return res.json(result);
});

module.exports = router;
