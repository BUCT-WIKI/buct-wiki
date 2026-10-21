const { readFileSync } = require('node:fs');
const { parse } = require('@iarna/toml');
const { previewPrefix } = require('./preview-repositories.cjs');

const DAY = 24 * 60 * 60 * 1000;
const POLICY = { successfulVersions: 3, closedDays: 7, failedDays: 7 };

function projectName(file) {
	const { name } = parse(readFileSync(file, 'utf8'));
	if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
		throw new Error(`Missing or invalid top-level project name in ${file}`);
	}
	return name;
}

function prNumber(deployment, prefix) {
	const branch = deployment.deployment_trigger?.metadata?.branch;
	if (!branch?.startsWith(prefix)) return null;
	const match = branch.slice(prefix.length).match(/^([1-9]\d*)$/);
	return match && Number.isSafeInteger(Number(match[1])) ? Number(match[1]) : null;
}

function cleanupReason(deployment, pr, recentSuccesses, now) {
	const status = deployment.latest_stage?.status;
	if (!['success', 'failure', 'canceled'].includes(status)) return;
	if (pr.state === 'closed') {
		const closedAt = Date.parse(pr.closed_at);
		if (Number.isFinite(closedAt) && now - closedAt >= POLICY.closedDays * DAY) {
			return `PR closed at least ${POLICY.closedDays} days ago`;
		}
		return;
	}
	if (pr.state !== 'open') return;
	if (status === 'success') {
		if (!recentSuccesses.has(deployment.id)) {
			return `Older than the latest ${POLICY.successfulVersions} successful previews`;
		}
		return;
	}
	if (now - Date.parse(deployment.created_on) >= POLICY.failedDays * DAY) {
		return `Failed preview at least ${POLICY.failedDays} days old`;
	}
}

function planCleanup(deployments, pulls, now = Date.now(), prefix = 'pr-') {
	const groups = new Map();
	for (const deployment of deployments) {
		const number = prNumber(deployment, prefix);
		if (deployment.environment !== 'preview' || !number) continue;
		if (!groups.has(number)) groups.set(number, []);
		groups.get(number).push(deployment);
	}
	const plan = [];
	for (const [number, versions] of groups) {
		const pr = pulls.get(number);
		if (!pr) continue;
		const uncertainDates = versions.some(deployment => {
			const createdAt = Date.parse(deployment.created_on);
			return !Number.isFinite(createdAt) || createdAt > now;
		});
		if (uncertainDates) continue;
		const successful = versions.filter(deployment => deployment.latest_stage?.status === 'success')
			.sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on));
		const recentSuccesses = new Set(successful.slice(0, POLICY.successfulVersions).map(deployment => deployment.id));
		for (const deployment of versions) {
			const reason = cleanupReason(deployment, pr, recentSuccesses, now);
			if (!reason) continue;
			// Active aliases require forced deletion. Never request it.
			const protectedAlias = Array.isArray(deployment.aliases) && deployment.aliases.length > 0;
			plan.push({ id: deployment.id, number, action: protectedAlias ? 'retain' : 'delete',
				reason: protectedAlias ? 'Active alias retained; no forced deletion' : reason });
		}
	}
	return plan;
}

function cloudflareClient({ account, project, token, fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
	if (!account || !token) throw new Error('Cloudflare credentials are missing');
	const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/pages/projects/${encodeURIComponent(project)}`;
	async function request(path, method = 'GET') {
		for (let attempt = 0; attempt < 3; attempt++) {
			let response;
			try {
				response = await fetchImpl(`${base}${path}`, {
					method, headers: { Authorization: `Bearer ${token}` },
					signal: AbortSignal.timeout(30_000),
				});
			} catch {
				if (attempt === 2) throw new Error('Cloudflare request failed after 3 attempts');
				await sleep(500 * 2 ** attempt);
				continue;
			}
			if ((response.status === 429 || response.status >= 500) && attempt < 2) {
				await sleep(500 * 2 ** attempt);
				continue;
			}
			const body = await response.json().catch(() => ({}));
			if (!response.ok || body.success !== true) {
				const error = new Error(`Cloudflare ${method} failed: HTTP ${response.status}; codes ${(body.errors || []).map(e => e.code).join(',')}`);
				error.status = response.status;
				throw error;
			}
			return body;
		}
	}
	return {
		async list() {
			const deployments = [];
			for (let page = 1; ; page++) {
				const body = await request(`/deployments?env=preview&per_page=100&page=${page}`);
				if (!Array.isArray(body.result)) throw new Error('Invalid deployment list');
				deployments.push(...body.result);
				if (!body.result.length || page >= body.result_info?.total_pages) return deployments;
			}
		},
		async get(id) { return (await request(`/deployments/${encodeURIComponent(id)}`)).result; },
		async remove(id) {
			try { await request(`/deployments/${encodeURIComponent(id)}`, 'DELETE'); }
			catch (error) {
				if (error.status === 404) return; // Already removed: rerunning is safe.
				throw error;
			}
		},
	};
}

async function removeUnchangedDeployment(cf, previous, core) {
	try {
		const current = await cf.get(previous.id);
		if (current.id !== previous.id || current.environment !== 'preview' || current.aliases?.length ||
			current.deployment_trigger?.metadata?.branch !== previous.deployment_trigger?.metadata?.branch ||
			current.latest_stage?.status !== previous.latest_stage?.status || current.created_on !== previous.created_on) {
			return 'retained: deployment changed or protected';
		}
		await cf.remove(previous.id);
		return 'deleted';
	} catch (error) {
		if (error.status === 404) return 'already absent';
		if (![400, 409].includes(error.status)) throw error;
		core.warning(`Cloudflare refused deletion of ${previous.id}; retained without forcing.`);
		return 'retained: Cloudflare refused deletion';
	}
}

async function cleanup({ github, context, core, dryRun = true, cf, now = Date.now() }) {
	const prefix = previewPrefix(`${context.repo.owner}/${context.repo.repo}`);
	const project = projectName('wrangler.toml');
	cf ||= cloudflareClient({
		project, account: process.env.CLOUDFLARE_ACCOUNT_ID,
		token: process.env.CLOUDFLARE_API_TOKEN,
	});
	const deployments = await cf.list();
	const pulls = new Map();
	for (const number of new Set(deployments.filter(d => d.environment === 'preview')
		.map(d => prNumber(d, prefix)).filter(Boolean))) {
		try {
			const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: number });
			if (pr.base.repo.full_name === `${context.repo.owner}/${context.repo.repo}`) pulls.set(number, pr);
		} catch (error) {
			if (error.status !== 404) throw error;
			core.warning(`PR #${number} not found; retaining its deployments.`);
		}
	}
	const plan = planCleanup(deployments, pulls, now, prefix);
	const deploymentsById = new Map(deployments.map(deployment => [deployment.id, deployment]));
	const results = [];
	for (const item of plan) {
		if (item.action === 'retain' || dryRun) {
			results.push({ ...item, result: item.action === 'retain' ? 'retained' : 'would delete' });
			continue;
		}
		// Recheck PR state and the live deployment immediately before each mutation.
		const { data: currentPr } = await github.rest.pulls.get({ ...context.repo, pull_number: item.number });
		const original = pulls.get(item.number);
		if (currentPr.state !== original.state || currentPr.closed_at !== original.closed_at ||
			currentPr.head.sha !== original.head.sha) {
			results.push({ ...item, result: 'retained: PR changed during cleanup' });
			continue;
		}
		const result = await removeUnchangedDeployment(cf, deploymentsById.get(item.id), core);
		results.push({ ...item, result });
		// Each completed deletion is persisted by Cloudflare; retries rebuild the plan.
		core.info(`PR #${item.number} / ${item.id}: ${result}`);
	}
	await core.summary.addHeading(dryRun ? 'Preview cleanup plan (no changes)' : 'Preview cleanup results')
		.addRaw(`Project: ${project}; preview branches: ${prefix}<number>. Keep ${POLICY.successfulVersions} successful versions per open PR; closed PR grace period: ${POLICY.closedDays} days.\n\n`)
		.addTable([
			['PR', 'Deployment', 'Result', 'Reason'],
			...results.map(r => [String(r.number), r.id, r.result, r.reason]),
		]).write();
	return results;
}

module.exports = { POLICY, projectName, planCleanup, cloudflareClient, cleanup };
