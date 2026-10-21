import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import previewDeploy from './preview-deploy.cjs';
import toml from '@iarna/toml';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtures = join(root, '.output/preview-tests');
mkdirSync(fixtures, { recursive: true });

function run(command, args, cwd, env = {}) {
	return spawnSync(command, args, {
		cwd,
		env: { ...process.env, ...env },
		encoding: 'utf8',
	});
}

function git(cwd, ...args) {
	const result = run('git', args, cwd, {
		GIT_AUTHOR_NAME: 'Preview Author',
		GIT_AUTHOR_EMAIL: 'preview@example.invalid',
		GIT_COMMITTER_NAME: 'Preview Author',
		GIT_COMMITTER_EMAIL: 'preview@example.invalid',
	});
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trim();
}

function sourceRepository() {
	const directory = mkdtempSync(join(fixtures, 'source-'));
	git(directory, 'init', '--initial-branch=main');
	writeFileSync(join(directory, 'article.md'), '# Original\n');
	git(directory, 'add', 'article.md');
	git(directory, 'commit', '-m', 'Add article');
	return directory;
}

test('preview publishing copies static files and only the trusted configuration', () => {
	const source = mkdtempSync(join(fixtures, 'assets-'));
	const destination = join(mkdtempSync(join(fixtures, 'publish-')), 'upload');
	writeFileSync(join(source, 'index.html'), '<h1>Preview</h1>');
	writeFileSync(join(source, 'wrangler.toml'), 'name = "untrusted"\n');
	writeFileSync(join(source, '_headers'), '/assets/*\n  Cache-Control: public\n');
	mkdirSync(join(source, 'assets/nested'), { recursive: true });
	writeFileSync(join(source, 'assets/nested/icon.svg'), '<svg/>');
	previewDeploy.prepareStaticPreview(source, destination, join(root, 'wrangler.toml'));
	assert.equal(readFileSync(join(destination, 'dist/index.html'), 'utf8'), '<h1>Preview</h1>');
	assert.equal(readFileSync(join(destination, 'dist/assets/nested/icon.svg'), 'utf8'), '<svg/>');
	assert.equal(readFileSync(join(destination, 'wrangler.toml'), 'utf8'),
		readFileSync(join(root, 'wrangler.toml'), 'utf8'));
	const config = toml.parse(readFileSync(join(destination, 'wrangler.toml'), 'utf8'));
	assert.equal(config.name, 'buct-wiki');
	assert.equal(config.d1_databases[0].binding, 'DB');
	assert.deepEqual(config.env.preview.d1_databases, []);
	assert.match(readFileSync(join(destination, 'dist/_headers'), 'utf8'), /X-Robots-Tag: noindex, nofollow/);
	assert.equal(existsSync(join(destination, 'functions')), false);
});

test('preview publishing rejects executable workers and symbolic links before copying', () => {
	for (const type of ['worker-file', 'worker-directory', 'symlink']) {
		const source = mkdtempSync(join(fixtures, 'unsafe-assets-'));
		const destination = join(mkdtempSync(join(fixtures, 'rejected-')), 'upload');
		writeFileSync(join(source, 'index.html'), '<h1>Preview</h1>');
		if (type === 'worker-file') writeFileSync(join(source, '_worker.js'), 'export default {}');
		if (type === 'worker-directory') mkdirSync(join(source, '_worker.js'));
		if (type === 'symlink') symlinkSync(join(root, 'package.json'), join(source, 'linked.json'));
		assert.throws(() => previewDeploy.prepareStaticPreview(source, destination, join(root, 'wrangler.toml')),
			/Unsupported preview asset|Executable Pages workers/);
		assert.equal(existsSync(destination), false);
	}
});

test('deployments only target an open PR at the exact build commit in this repository', async () => {
	const context = {
		repo: { owner: 'BUCT-WIKI', repo: 'buct-wiki' },
		payload: { workflow_run: {
			event: 'pull_request', conclusion: 'success',
			path: '.github/workflows/pr-preview-build.yml', head_sha: 'abc123',
			head_repository: { full_name: 'contributor/wiki' }, head_branch: 'feature',
		} },
	};
	const pr = { number: 12, state: 'open', head: {
		sha: 'abc123', ref: 'feature', repo: { full_name: 'contributor/wiki' },
	},
		base: { ref: 'main', repo: { full_name: 'BUCT-WIKI/buct-wiki' } } };
	let pulls = [pr];
	const github = { rest: { repos: { listPullRequestsAssociatedWithCommit: {} } },
		paginate: async (_method, args) => {
			assert.equal(args.commit_sha, 'abc123');
			return pulls;
		} };
	assert.equal(await previewDeploy.findPullRequest(github, context), pr);
	for (const invalid of [
		{ ...pr, state: 'closed' },
		{ ...pr, head: { sha: 'newer' } },
		{ ...pr, base: { ref: 'main', repo: { full_name: 'other/repo' } } },
	]) {
		pulls = [invalid];
		assert.equal(await previewDeploy.findPullRequest(github, context), null);
	}
	pulls = [pr, { ...pr, number: 13 }];
	assert.equal(await previewDeploy.findPullRequest(github, context), null);
	pulls = [pr, { ...pr, number: 13, head: { ...pr.head, repo: { full_name: 'another/wiki' } } },
		{ ...pr, number: 14, head: { ...pr.head, ref: 'another-branch' } }];
	assert.equal(await previewDeploy.findPullRequest(github, context), pr);
	context.payload.workflow_run.conclusion = 'failure';
	assert.equal(await previewDeploy.findPullRequest(github, context), pr);
	context.payload.workflow_run.conclusion = 'cancelled';
	assert.equal(await previewDeploy.findPullRequest(github, context), pr);
	pulls = [pr];
	context.payload.workflow_run.event = 'push';
	assert.equal(await previewDeploy.findPullRequest(github, context), null);
});

test('content PR matching uses the content repository, not a same-number template PR', async () => {
	const pr = { number: 12, state: 'open',
		head: { sha: 'content-sha', ref: 'article', repo: { full_name: 'author/content' } },
		base: { ref: 'main', repo: { full_name: 'BUCT-WIKI/buct-wiki-content' } } };
	const context = { repo: { owner: 'BUCT-WIKI', repo: 'buct-wiki-content' },
		payload: { workflow_run: { event: 'pull_request', conclusion: 'success',
			path: '.github/workflows/pr-preview-build.yml', head_sha: 'content-sha',
			head_repository: pr.head.repo, head_branch: 'article' } } };
	const github = { rest: { repos: { listPullRequestsAssociatedWithCommit: {} } },
		paginate: async () => [pr, { ...pr, base: { ...pr.base, repo: { full_name: 'BUCT-WIKI/buct-wiki' } } }] };
	assert.equal(await previewDeploy.findPullRequest(github, context), pr);
});

function reportingFixture() {
	const context = {
		repo: { owner: 'BUCT-WIKI', repo: 'buct-wiki' }, serverUrl: 'https://github.com', runId: 100,
		payload: { workflow_run: { conclusion: 'success', id: 99 } },
	};
	const pr = { number: 12, state: 'open', head: { sha: 'abc123' } };
	const statuses = [];
	const comments = [];
	const outputs = {};
	const core = { setOutput: (name, value) => { outputs[name] = value; } };
	const github = {
		paginate: async () => comments,
		rest: {
			pulls: { get: async () => ({ data: pr }) },
			repos: {
				createDeployment: async args => {
					assert.equal(args.auto_merge, false);
					assert.deepEqual(args.required_contexts, []);
					assert.equal(args.ref, pr.head.sha);
					return { data: { id: 42 } };
				},
				createDeploymentStatus: async args => { statuses.push(args); },
			},
			issues: {
				listComments: {},
				createComment: async args => {
					comments.push({ ...args, id: 1, user: { login: 'github-actions[bot]' } });
				},
				updateComment: async args => { comments[0].body = args.body; },
			},
		},
	};
	const result = { deploymentId: 42, number: 12, sha: 'abc123',
		url: 'https://hash.preview.pages.dev', alias: 'https://pr-12.preview.pages.dev' };
	return { github, context, core, outputs, pr, statuses, comments, result };
}

test('preview reporting transitions pending to success and updates the same comment on rerun', async () => {
	const f = reportingFixture();
	await previewDeploy.startPreview(f.github, f.context, f.core, f.pr);
	assert.equal(f.outputs.id, 42);
	assert.equal(f.statuses[0].state, 'pending');
	await previewDeploy.finishPreview(f.github, f.context, f.result);
	await previewDeploy.finishPreview(f.github, f.context, f.result);
	assert.equal(f.statuses[1].state, 'success');
	assert.equal(f.statuses[1].environment_url, f.result.alias);
	assert.equal(f.comments.length, 1);
	assert.match(f.comments[0].body, /打开最近成功预览/);
	assert.ok(f.comments[0].body.includes(f.result.url));
});

test('pending status failure preserves the deployment ID for failure reporting', async () => {
	const f = reportingFixture();
	const createStatus = f.github.rest.repos.createDeploymentStatus;
	f.github.rest.repos.createDeploymentStatus = async args => {
		if (args.state === 'pending') throw new Error('Pending status unavailable');
		return createStatus(args);
	};
	await assert.rejects(previewDeploy.startPreview(f.github, f.context, f.core, f.pr),
		/Pending status unavailable/);
	assert.equal(f.outputs.id, 42);
	await previewDeploy.finishPreview(f.github, f.context, {
		...f.result, deploymentId: f.outputs.id, url: '',
	});
	assert.equal(f.statuses[0].deployment_id, f.outputs.id);
	assert.equal(f.statuses[0].state, 'failure');
	assert.match(f.comments[0].body, /发布失败/);
});

test('deployment creation failure does not expose an ID for the finalizer', async () => {
	const f = reportingFixture();
	f.github.rest.repos.createDeployment = async () => { throw new Error('Deployment API unavailable'); };
	await assert.rejects(previewDeploy.startPreview(f.github, f.context, f.core, f.pr),
		/Deployment API unavailable/);
	assert.equal(f.outputs.id, undefined);
	assert.equal(f.statuses.length, 0);
});

test('build failures, cancellations and upload failures replace stale success feedback', async () => {
	for (const conclusion of ['failure', 'cancelled', 'success']) {
		const f = reportingFixture();
		await previewDeploy.finishPreview(f.github, f.context, f.result);
		f.context.payload.workflow_run.conclusion = conclusion;
		await previewDeploy.finishPreview(f.github, f.context, { ...f.result, url: '' });
		assert.equal(f.statuses.at(-1).state, 'failure');
		assert.equal(f.statuses.at(-1).environment_url, undefined);
		assert.match(f.comments[0].body, /发布失败|构建未成功/);
		assert.doesNotMatch(f.comments[0].body, /打开最近成功预览/);
		assert.ok(f.comments[0].body.includes(`/runs/${conclusion === 'success' ? 100 : 99}`));
		assert.equal(f.comments.length, 1);
	}
});

test('closed or updated PRs get deployment status without replacing their current comment', async () => {
	for (const change of [{ state: 'closed' }, { head: { sha: 'newer' } }]) {
		const f = reportingFixture();
		Object.assign(f.pr, change);
		await previewDeploy.finishPreview(f.github, f.context, f.result);
		assert.equal(f.statuses[0].state, 'success');
		assert.equal(f.comments.length, 0);
	}
});

test('reporting surfaces API errors and can retry a failed comment without duplicating it', async () => {
	const f = reportingFixture();
	const createComment = f.github.rest.issues.createComment;
	f.github.rest.issues.createComment = async () => { throw new Error('Comment API unavailable'); };
	await assert.rejects(previewDeploy.finishPreview(f.github, f.context, f.result), /Comment API unavailable/);
	assert.equal(f.statuses[0].state, 'success');
	f.github.rest.issues.createComment = createComment;
	await previewDeploy.finishPreview(f.github, f.context, f.result);
	assert.equal(f.comments.length, 1);
	f.github.rest.repos.createDeploymentStatus = async () => { throw new Error('Status API unavailable'); };
	await assert.rejects(previewDeploy.finishPreview(f.github, f.context, f.result), /Status API unavailable/);
});

test('contributors retain GitHub profiles and history across renamed files', () => {
	const source = sourceRepository();
	git(source, 'mv', 'article.md', 'renamed.md');
	git(source, 'commit', '-m', 'Rename article');
	const output = mkdtempSync(join(fixtures, 'metadata-'));
	const author = { id: 7, login: 'preview-author',
		avatar_url: 'https://example.invalid/avatar', html_url: 'https://example.invalid/author' };
	const commits = git(source, 'log', '--format=%H').split('\n').map(sha => ({ sha, author }));
	const mockApi = join(output, 'mock-api.mjs');
	writeFileSync(mockApi, `globalThis.fetch = async () => Response.json(${JSON.stringify(commits)});\n`);
	const result = run(process.execPath, [
		'--import', mockApi, join(root, 'scripts/generate-contributors.mjs'),
	], output, { GITHUB_TOKEN: 'test-only-token', CONTENT_DIR: source });
	assert.equal(result.status, 0, result.stderr);
	const contributors = JSON.parse(readFileSync(join(output, '.output/contributors.json')));
	const dates = JSON.parse(readFileSync(join(output, '.output/last-modified.json')));
	assert.deepEqual(contributors['content/renamed'], [{
		id: author.id, name: author.login, avatar: author.avatar_url, profile: author.html_url, commits: 2,
	}]);
	assert.equal(dates['content/renamed'], git(source, 'log', '-1', '--format=%aI'));
});

test('content fetching updates clean checkouts and preserves local edits', () => {
	const source = sourceRepository();
	const destination = join(mkdtempSync(join(fixtures, 'checkout-')), 'content');
	const env = { CONTENT_GIT_URL: source, CONTENT_GIT_REF: 'main', CONTENT_DIR: destination };
	const fetchContent = () => run('bash', ['scripts/fetch-content.sh'], root, env);
	let result = fetchContent();
	assert.equal(result.status, 0, result.stderr);

	writeFileSync(join(source, 'article.md'), '# Updated\n');
	git(source, 'add', 'article.md');
	git(source, 'commit', '-m', 'Update article');
	result = fetchContent();
	assert.equal(result.status, 0, result.stderr);
	assert.equal(git(destination, 'rev-parse', 'HEAD'), git(source, 'rev-parse', 'HEAD'));

	writeFileSync(join(destination, 'article.md'), '# Local edit\n');
	result = fetchContent();
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /local changes/);
	assert.equal(readFileSync(join(destination, 'article.md'), 'utf8'), '# Local edit\n');
});

test('content fetching accepts an exact PR commit and preserves its history', () => {
	const source = sourceRepository();
	const selected = git(source, 'rev-parse', 'HEAD');
	writeFileSync(join(source, 'article.md'), '# Later main\n');
	git(source, 'add', 'article.md');
	git(source, 'commit', '-m', 'Advance main after preview event');
	const destination = join(mkdtempSync(join(fixtures, 'commit-checkout-')), 'content');
	const result = run('bash', ['scripts/fetch-content.sh'], root, {
		CONTENT_GIT_URL: source, CONTENT_GIT_REF: selected, CONTENT_DIR: destination,
	});
	assert.equal(result.status, 0, result.stderr);
	assert.equal(git(destination, 'rev-parse', 'HEAD'), selected);
	assert.equal(readFileSync(join(destination, 'article.md'), 'utf8'), '# Original\n');
	assert.equal(git(destination, 'log', '-1', '--format=%s'), 'Add article');
});
