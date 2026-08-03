import { execFileSync } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, sep } from 'node:path';

const token = process.env.GITHUB_TOKEN;
const repository = process.env.CONTENT_GITHUB_REPOSITORY ?? 'BUCT-WIKI/buct-wiki-content';
const contentDir = process.env.CONTENT_DIR ?? 'src/content/docs/content';
const output = '.output/contributors.json';
const lastModifiedOutput = '.output/last-modified.json';

if (!token) throw new Error('Missing GITHUB_TOKEN');

async function findDocuments(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = await Promise.all(entries.map((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? findDocuments(path) : path;
	}));
	return files.flat().filter((path) => ['.md', '.mdx'].includes(extname(path)));
}

const documents = new Map();
const lastModifiedByDoc = new Map();
const commitAuthors = new Map();

for (const file of await findDocuments(contentDir)) {
	const path = relative(contentDir, file).split(sep).join('/');
	const id = `content/${path.slice(0, -extname(path).length)}`;
	const history = execFileSync(
		'git',
		['-C', contentDir, 'log', '--follow', '--format=%H%x09%an%x09%aI', '--', path],
		{ encoding: 'utf8' },
	).trim();

	const commits = history ? history.split('\n').map((line) => {
		const [sha, name, authorDate] = line.split('\t');
		commitAuthors.set(sha, { name });
		if (!lastModifiedByDoc.has(id)) {
			lastModifiedByDoc.set(id, authorDate);
		}
		return sha;
	}) : [];

	documents.set(id, commits);
}

const unresolved = new Set(commitAuthors.keys());
for (let page = 1; unresolved.size; page++) {
	const response = await fetch(
		`https://api.github.com/repos/${repository}/commits?per_page=100&page=${page}`,
		{
			headers: {
				Accept: 'application/vnd.github+json',
				Authorization: `Bearer ${token}`,
				'User-Agent': 'buct-wiki-build',
				'X-GitHub-Api-Version': '2022-11-28',
			},
		},
	);

	if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
	const commits = await response.json();
	if (!commits.length) break;

	for (const commit of commits) {
		if (!unresolved.delete(commit.sha)) continue;
		if (commit.author) {
			commitAuthors.set(commit.sha, {
				id: commit.author.id,
				name: commit.author.login,
				avatar: commit.author.avatar_url,
				profile: commit.author.html_url,
			});
		}
	}
}

const result = Object.fromEntries(Array.from(documents, ([id, commits]) => {
	const contributors = new Map();
	for (const sha of commits) {
		const author = commitAuthors.get(sha);
		if (!author) continue;
		const key = author.id ? `github:${author.id}` : `git:${author.name}`;
		const current = contributors.get(key);
		contributors.set(key, { ...author, commits: (current?.commits ?? 0) + 1 });
	}
	return [id, Array.from(contributors.values()).sort((a, b) => b.commits - a.commits)];
}));

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
await writeFile(lastModifiedOutput, `${JSON.stringify(Object.fromEntries(lastModifiedByDoc), null, 2)}\n`);
console.log(`Generated contributors for ${documents.size} documents.`);
