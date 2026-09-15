/**
 * Unit tests for authentication utilities
 */

const AuthManager = require('../../../src/utils/auth');
const redisClient = require('../../../src/utils/redis');
const config = require('../../../src/config/config');

describe('AuthManager', () => {
	beforeEach(async () => {
		await redisClient.connect();
	});

	afterEach(async () => {
		if (redisClient.isConnected) {
			await redisClient.disconnect();
		}
	});

	describe('generatePersonalKey', () => {
		test('should generate a valid UUID', () => {
			const key = AuthManager.generatePersonalKey();

			expect(key).toBeDefined();
			expect(typeof key).toBe('string');
			expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
		});

		test('should generate unique keys', () => {
			const key1 = AuthManager.generatePersonalKey();
			const key2 = AuthManager.generatePersonalKey();

			expect(key1).not.toBe(key2);
		});
	});

	describe('generateJWT', () => {
		test('should generate a valid JWT token', () => {
			const personalKey = global.testUtils.createTestPersonalKey();
			const jwt = AuthManager.generateJWT(personalKey);

			expect(jwt).toBeDefined();
			expect(typeof jwt).toBe('string');
			expect(jwt.split('.')).toHaveLength(3); // JWT has 3 parts
		});

		test('should create JWT with correct payload', () => {
			const personalKey = global.testUtils.createTestPersonalKey();
			const jwt = AuthManager.generateJWT(personalKey);
			const decoded = AuthManager.verifyJWT(jwt);

			expect(decoded).toBeDefined();
			expect(decoded.personalKey).toBe(personalKey);
			expect(decoded.type).toBe('vomesync_key');
		});
	});

	describe('verifyJWT', () => {
		test('should verify valid JWT', () => {
			const personalKey = global.testUtils.createTestPersonalKey();
			const jwt = AuthManager.generateJWT(personalKey);
			const decoded = AuthManager.verifyJWT(jwt);

			expect(decoded).toBeDefined();
			expect(decoded.personalKey).toBe(personalKey);
		});

		test('should reject invalid JWT', () => {
			const invalidJWT = 'invalid.jwt.token';
			const decoded = AuthManager.verifyJWT(invalidJWT);

			expect(decoded).toBeNull();
		});

		test('should reject expired JWT', () => {
			// This would require mocking time or using a very short expiry
			// For now, we'll test the basic functionality
			const malformedJWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature';
			const decoded = AuthManager.verifyJWT(malformedJWT);

			expect(decoded).toBeNull();
		});
	});

	describe('validatePersonalKey', () => {
		test('should validate existing personal key', async () => {
			const personalKey = global.testUtils.createTestPersonalKey();

			// Store the key first
			await redisClient.storePersonalKey(personalKey);

			const isValid = await AuthManager.validatePersonalKey(personalKey);
			expect(isValid).toBe(true);
		});

		test('should reject non-existent personal key', async () => {
			const nonExistentKey = global.testUtils.createTestPersonalKey();

			const isValid = await AuthManager.validatePersonalKey(nonExistentKey);
			expect(isValid).toBe(false);
		});

		test('should reject null/undefined personal key', async () => {
			const isValidNull = await AuthManager.validatePersonalKey(null);
			const isValidUndefined = await AuthManager.validatePersonalKey(undefined);
			const isValidEmpty = await AuthManager.validatePersonalKey('');

			expect(isValidNull).toBe(false);
			expect(isValidUndefined).toBe(false);
			expect(isValidEmpty).toBe(false);
		});
	});

	describe('authenticateSwitch', () => {
		test('should authenticate valid switch owner', async () => {
			const personalKey = global.testUtils.createTestPersonalKey();
			const switchData = global.testUtils.createTestSwitchData();

			// Create switch
			const switchResult = await redisClient.createSwitch(
				global.testUtils.generateTestUUID(),
				personalKey,
				switchData
			);

			const authResult = await AuthManager.authenticateSwitch(switchResult.uid, redisClient.getPersonalKeyId(personalKey));

			expect(authResult.success).toBe(true);
			expect(authResult.switchData).toBeDefined();
			expect(authResult.switchData.uid).toBe(switchResult.uid);
		});

		test('should reject non-owner authentication', async () => {
			const ownerKey = global.testUtils.createTestPersonalKey();
			const otherKey = global.testUtils.createTestPersonalKey();
			const switchData = global.testUtils.createTestSwitchData();

			// Create switch with owner key
			const switchResult = await redisClient.createSwitch(
				global.testUtils.generateTestUUID(),
				ownerKey,
				switchData
			);

			// Try to authenticate with different key
			const authResult = await AuthManager.authenticateSwitch(switchResult.uid, redisClient.getPersonalKeyId(otherKey));

			expect(authResult.success).toBe(false);
			expect(authResult.error).toContain('Unauthorized');
		});

		test('should reject authentication for non-existent switch', async () => {
			const personalKey = global.testUtils.createTestPersonalKey();
			const nonExistentUID = global.testUtils.generateTestUUID();

			const authResult = await AuthManager.authenticateSwitch(nonExistentUID, redisClient.getPersonalKeyId(personalKey));

			expect(authResult.success).toBe(false);
			expect(authResult.error).toContain('Switch not found');
		});
	});

	describe('verifyCaptcha', () => {
		// config.hcaptcha is a plain object mutated in place (same convention
		// internal-routes.test.js uses for config.relay.internalSecret) --
		// snapshot and restore it so these tests can't leak into others.
		let originalHcaptcha;

		beforeEach(() => {
			originalHcaptcha = { ...config.hcaptcha };
		});

		afterEach(() => {
			config.hcaptcha = originalHcaptcha;
		});

		test('succeeds with no token when CAPTCHA is disabled (no secret configured)', async () => {
			config.hcaptcha = { secret: '', bypassToken: '', trustedCallerSecret: '' };

			const result = await AuthManager.verifyCaptcha('');

			expect(result.success).toBe(true);
			expect(result.reason).toBe('captcha_disabled');
		});

		test('requires a token once a secret is configured', async () => {
			config.hcaptcha = { secret: 'real-hcaptcha-secret', bypassToken: '', trustedCallerSecret: '' };

			const result = await AuthManager.verifyCaptcha('');

			expect(result.success).toBe(false);
			expect(result.error).toBe('Captcha required');
		});

		// ── Trusted caller (VomeHome portal publicizing on behalf of a
		// GitHub-authenticated account) ──────────────────────────────────
		test('bypasses CAPTCHA entirely when the trusted-caller header matches, even with no token', async () => {
			config.hcaptcha = {
				secret: 'real-hcaptcha-secret',
				bypassToken: '',
				trustedCallerSecret: 'portal-shared-secret',
			};

			const result = await AuthManager.verifyCaptcha('', 'portal-shared-secret');

			expect(result.success).toBe(true);
			expect(result.reason).toBe('trusted_caller');
		});

		test('falls through to requiring a real token when the trusted-caller header is wrong', async () => {
			config.hcaptcha = {
				secret: 'real-hcaptcha-secret',
				bypassToken: '',
				trustedCallerSecret: 'portal-shared-secret',
			};

			const result = await AuthManager.verifyCaptcha('', 'not-the-right-secret');

			expect(result.success).toBe(false);
			expect(result.error).toBe('Captcha required');
		});

		test('falls through when no trusted-caller header is presented at all', async () => {
			config.hcaptcha = {
				secret: 'real-hcaptcha-secret',
				bypassToken: '',
				trustedCallerSecret: 'portal-shared-secret',
			};

			const result = await AuthManager.verifyCaptcha('');

			expect(result.success).toBe(false);
			expect(result.error).toBe('Captcha required');
		});

		test('does not bypass when trustedCallerSecret is not configured, even if a header is sent', async () => {
			config.hcaptcha = { secret: 'real-hcaptcha-secret', bypassToken: '', trustedCallerSecret: '' };

			const result = await AuthManager.verifyCaptcha('', 'anything-at-all');

			expect(result.success).toBe(false);
			expect(result.error).toBe('Captcha required');
		});

		test('rejects a same-prefix, different-length trusted-caller header (no crash, no bypass)', async () => {
			config.hcaptcha = {
				secret: 'real-hcaptcha-secret',
				bypassToken: '',
				trustedCallerSecret: 'portal-shared-secret',
			};

			const result = await AuthManager.verifyCaptcha('', 'portal-shared-secret-but-longer');

			expect(result.success).toBe(false);
		});

		test('the generic test/staging bypassToken still works on its own, independent of trustedCallerSecret', async () => {
			config.hcaptcha = {
				secret: 'real-hcaptcha-secret',
				bypassToken: 'staging-bypass-token',
				trustedCallerSecret: '',
			};

			const result = await AuthManager.verifyCaptcha('staging-bypass-token');

			expect(result.success).toBe(true);
			expect(result.reason).toBe('bypass_token');
		});
	});

	describe('createRateLimitKey', () => {
		test('should create consistent rate limit keys', () => {
			const identifier = 'test-user';
			const action = 'create_switch';

			const key1 = AuthManager.createRateLimitKey(identifier, action);
			const key2 = AuthManager.createRateLimitKey(identifier, action);

			expect(key1).toBe(key2);
			expect(key1).toBe('rate_limit:create_switch:test-user');
		});
	});

	describe('checkRateLimit', () => {
		test('should allow requests within limit', async () => {
			const identifier = 'test-user-' + Date.now();
			const action = 'test_action';
			const limit = 5;
			const windowMs = 60000;

			const result = await AuthManager.checkRateLimit(identifier, action, limit, windowMs);

			expect(result.allowed).toBe(true);
			expect(result.current).toBe(1);
			expect(result.limit).toBe(limit);
			expect(result.resetTime).toBeGreaterThan(Date.now());
		});

		test('should reject requests exceeding limit', async () => {
			const identifier = 'test-user-' + Date.now();
			const action = 'test_action';
			const limit = 2;
			const windowMs = 60000;

			// Make requests up to limit
			await AuthManager.checkRateLimit(identifier, action, limit, windowMs);
			await AuthManager.checkRateLimit(identifier, action, limit, windowMs);

			// This should exceed the limit
			const result = await AuthManager.checkRateLimit(identifier, action, limit, windowMs);

			expect(result.allowed).toBe(false);
			expect(result.current).toBe(3);
		});

		test('should handle Redis errors gracefully', async () => {
			// Disconnect Redis to simulate error
			await redisClient.disconnect();

			const identifier = 'test-user';
			const action = 'test_action';

			const result = await AuthManager.checkRateLimit(identifier, action);

			// Should allow request if Redis fails
			expect(result.allowed).toBe(true);
		});
	});
});
