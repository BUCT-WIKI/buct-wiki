import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import previewCleanup from './preview-cleanup.cjs';

const { projectName, planCleanup, cloudflareClient, cleanup } = previewCleanup;
const now = Date.parse('2026-10-20T12:00:00Z');
const day = 86_400_000;
const date = days => new Date(now - days * day).toISOString();
const pull = (number, state = 'open', closedDays = 8) => ({
	number, state, closed_at: state === 'closed' ? date(closedDays) : null,
	head: { sha: 'current-sha' }, base: { repo: { full_name: 'BUCT-WIKI/buct-wiki' } },
});
const deployment = (id, number, age, overrides = {}) => ({
	id, environment: 'preview', created_on: date(age), aliases: [],
	deployment_trigger: { metadata: { branch: `pr-${number}` } },
	latest_stage: { status: 'success' }, ...overrides,
});

test('project configuration accepts TOML formatting while requiring a valid top-level name', () => {
	mkdirSync('.output/preview-tests', { recursive: true });
	const file = join(mkdtempSync('.output/preview-tests/config-'), 'wrangler.toml');
	for (const source of [
		'name = "buct-wiki" # Shared Pages project\n',
		"  name = 'buct-wiki'\n",
		'name = "buct-wiki"\n[vars]\nname = "nested"\n',
	]) {
		writeFileSync(file, source);
		assert.equal(projectName(file), 'buct-wiki');
	}
	for (const source of ['[vars]\nname = "nested"', 'name = 42', 'name = "../production"']) {
		writeFileSync(file, source);
		assert.throws(() => projectName(file), /Missing or invalid top-level project name/);
	}
	writeFileSync(file, 'name = "unterminated');
	assert.throws(() => projectName(file));
});

test('open PRs independently keep their three newest successful versions', () => {
	const versions = [
		deployment('a-old', 1, 9), deployment('b-old', 2, 9),
		...Array.from({ length: 3 }, (_, i) => deployment(`a-${i}`, 1, i + 1)),
		...Array.from({ length: 3 }, (_, i) => deployment(`b-${i}`, 2, i + 1)),
		deployment('failed-new', 1, 1, { latest_stage: { status: 'failure' } }),
		deployment('failed-old', 1, 8, { latest_stage: { status: 'failure' } }),
		deployment('building', 1, 10, { latest_stage: { status: 'active' } }),
	];
	const plan = planCleanup(versions, new Map([[1, pull(1)], [2, pull(2)]]), now);
	assert.deepEqual(plan.map(p => p.id).sort(), ['a-old', 'b-old', 'failed-old']);
	assert.ok(plan.every(p => p.action === 'delete'));
});

test('closed PR grace period starts at closure; aliases remain protected', () => {
	const versions = [
		deployment('recently-closed', 1, 90),
		deployment('expired', 2, 90),
		deployment('alias', 2, 10, { aliases: ['https://pr-2.example.pages.dev'] }),
	];
	const plan = planCleanup(versions, new Map([[1, pull(1, 'closed', 6)], [2, pull(2, 'closed', 7)]]), now);
	assert.deepEqual(plan.map(p => [p.id, p.action]), [['expired', 'delete'], ['alias', 'retain']]);
});

test('production, unrelated branches, missing PRs and uncertain dates are never selected', () => {
	const versions = [
		deployment('production', 1, 90, { environment: 'production' }),
		deployment('branch', 1, 90, { deployment_trigger: { metadata: { branch: 'main' } } }),
		deployment('missing-pr', 2, 90),
		deployment('unknown-date', 3, 90, { created_on: 'invalid' }),
		deployment('otherwise-old', 3, 90),
	];
	const pulls = new Map([[1, pull(1, 'closed')], [3, pull(3, 'closed')]]);
	assert.deepEqual(planCleanup(versions, pulls, now), []);
});

function harness({ changedPr, liveDeployment, rejectDeletion } = {}) {
	const d = deployment('old', 1, 10);
	const calls = [];
	let reads = 0;
	const github = { rest: { pulls: { get: async () => ({
		data: ++reads > 1 && changedPr ? changedPr : pull(1, 'closed'),
	}) } } };
	const cf = {
		list: async () => [d],
		get: async () => liveDeployment || d,
		remove: async id => {
			calls.push(id);
			if (rejectDeletion) throw Object.assign(new Error('Protected'), { status: 400 });
		},
	};
	const summary = { addHeading() { return this; }, addRaw() { return this; },
		addTable() { return this; }, async write() {} };
	const core = { info() {}, warning() {}, summary };
	return { args: { github, cf, core, now, context: { repo: { owner: 'BUCT-WIKI', repo: 'buct-wiki' } } }, calls };
}

test('dry run is the default and never removes anything', async () => {
	const { args, calls } = harness();
	const result = await cleanup(args);
	assert.equal(result[0].result, 'would delete');
	assert.deepEqual(calls, []);
});

test('shared-project cleanup excludes production deployments even when their branch matches a PR', async () => {
	const { args, calls } = harness();
	const eligible = deployment('preview', 1, 10);
	args.cf.list = async () => [
		eligible,
		deployment('production', 1, 90, { environment: 'production' }),
		deployment('main', 1, 90, { deployment_trigger: { metadata: { branch: 'main' } } }),
	];
	args.cf.get = async id => {
		assert.equal(id, 'preview');
		return eligible;
	};
	await cleanup({ ...args, dryRun: false });
	assert.deepEqual(calls, ['preview']);
});

test('apply retains reopened PRs and deployments that changed or became protected', async () => {
	for (const options of [
		{ changedPr: pull(1) },
		{ liveDeployment: deployment('old', 1, 10, { environment: 'production' }) },
		{ liveDeployment: deployment('old', 1, 10, { aliases: ['https://pr-1.example.pages.dev'] }) },
		{ liveDeployment: deployment('different-id', 1, 10) },
		{ liveDeployment: deployment('old', 2, 10) },
		{ liveDeployment: deployment('old', 1, 9) },
		{ liveDeployment: deployment('old', 1, 10, { latest_stage: { status: 'active' } }) },
	]) {
		const { args, calls } = harness(options);
		await cleanup({ ...args, dryRun: false });
		assert.deepEqual(calls, []);
	}
});

test('deployment rechecks tolerate already absent previews but surface unexpected API failures', async () => {
	for (const status of [404, 503]) {
		const { args, calls } = harness();
		args.cf.get = async () => { throw Object.assign(new Error('Deployment read failed'), { status }); };
		if (status === 404) {
			const results = await cleanup({ ...args, dryRun: false });
			assert.equal(results[0].result, 'already absent');
		} else {
			await assert.rejects(cleanup({ ...args, dryRun: false }), /Deployment read failed/);
		}
		assert.deepEqual(calls, []);
	}
});

test('apply removes eligible previews; provider refusal is reported without forcing', async () => {
	const allowed = harness();
	const result = await cleanup({ ...allowed.args, dryRun: false });
	assert.deepEqual(allowed.calls, ['old']);
	assert.equal(result[0].result, 'deleted');
	const protectedDeployment = harness({ rejectDeletion: true });
	const refused = await cleanup({ ...protectedDeployment.args, dryRun: false });
	assert.equal(refused[0].result, 'retained: Cloudflare refused deletion');
	assert.deepEqual(protectedDeployment.calls, ['old']);
});

test('Cloudflare pagination, retries and idempotent removal use no force parameter', async () => {
	const requests = [];
	let throttled = false;
	const cf = cloudflareClient({
		account: 'account', project: 'preview', token: 'test-only-token', sleep: async () => {},
		fetchImpl: async (url, options) => {
			requests.push({ url, method: options.method });
			assert.equal(new URL(url).searchParams.has('force'), false);
			if (options.method === 'DELETE') return Response.json({ success: false }, { status: 404 });
			assert.equal(new URL(url).searchParams.get('env'), 'preview');
			if (!throttled) {
				throttled = true;
				return Response.json({ success: false }, { status: 429 });
			}
			const page = Number(new URL(url).searchParams.get('page'));
			return Response.json({ success: true, result: [{ id: `page-${page}` }], result_info: { total_pages: 2 } });
		},
	});
	assert.deepEqual(await cf.list(), [{ id: 'page-1' }, { id: 'page-2' }]);
	await cf.remove('already-gone');
	assert.equal(requests.length, 4);
	assert.equal(requests.at(-1).method, 'DELETE');
});

test('Cloudflare HTTP success with a failed API result stops cleanup', async () => {
	const cf = cloudflareClient({
		account: 'account', project: 'preview', token: 'test-only-token',
		fetchImpl: async () => Response.json({ success: false, errors: [{ code: 1000 }] }),
	});
	await assert.rejects(cf.list(), /HTTP 200; codes 1000/);
});
