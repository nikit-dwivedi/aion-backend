import test from 'node:test';
import assert from 'node:assert';
import { validateUrlForSsrf } from '../features/capture/capture.service.js';
import { AppError } from '../core/middlewares/error.middleware.js';
test('SSRF Protection Tests', async (t) => {
    await t.test('Should allow safe public URLs', async () => {
        const url = 'https://google.com';
        const result = await validateUrlForSsrf(url);
        assert.strictEqual(result, 'https://google.com/');
    });
    await t.test('Should block localhost IPv4', async () => {
        const url = 'http://127.0.0.1/admin';
        await assert.rejects(async () => {
            await validateUrlForSsrf(url);
        }, (err) => {
            assert.ok(err instanceof AppError);
            assert.strictEqual(err.statusCode, 400);
            assert.ok(err.message.includes('blocked') || err.message.includes('private'));
            return true;
        });
    });
    await t.test('Should block private IP subnets (10.0.0.0/8)', async () => {
        // If the host resolves to a private IP, it should block it.
        // We can pass a URL with direct IP to guarantee resolution check
        const url = 'http://10.10.10.10/metadata';
        await assert.rejects(async () => {
            await validateUrlForSsrf(url);
        }, (err) => {
            assert.ok(err instanceof AppError);
            assert.strictEqual(err.statusCode, 400);
            assert.ok(err.message.includes('blocked') || err.message.includes('private'));
            return true;
        });
    });
});
//# sourceMappingURL=aion.test.js.map