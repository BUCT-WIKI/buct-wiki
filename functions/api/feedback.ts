interface Env {
	DB: D1Database;
}

interface FeedbackRequest {
	path?: unknown;
	type?: unknown;
	content?: unknown;
}

const FEEDBACK_TYPES = new Set([
	'factual_error',
	'outdated',
	'missing_content',
	'unclear',
	'typo',
	'broken_link',
	'suggestion',
	'other',
]);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
	if (!env.DB) {
		return Response.json({ error: 'D1 binding DB is missing' }, { status: 500 });
	}

	let body: FeedbackRequest;

	try {
		body = await request.json();
	} catch {
		return Response.json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const path = normalizePath(body.path);
	const type = typeof body.type === 'string' ? body.type : '';
	const content = typeof body.content === 'string' ? body.content.trim() : '';

	if (!path) {
		return Response.json({ error: 'Invalid path' }, { status: 400 });
	}

	if (!FEEDBACK_TYPES.has(type)) {
		return Response.json({ error: 'Invalid feedback type' }, { status: 400 });
	}

	if (content.length < 10 || content.length > 2000) {
		return Response.json({ error: 'Content must be between 10 and 2000 characters' }, { status: 400 });
	}

	try {
		const result = await env.DB.prepare(`
			INSERT INTO feedback (path, type, content, status, created_at, updated_at)
			VALUES (?, ?, ?, 'pending', datetime('now'), datetime('now'))
		`)
			.bind(path, type, content)
			.run();

		return Response.json(
			{
				success: true,
				id: result.meta.last_row_id,
			},
			{ status: 201 }
		);
	} catch {
		return Response.json({ error: 'Failed to save feedback' }, { status: 500 });
	}
};

function normalizePath(value: unknown) {
	if (typeof value !== 'string') return null;

	try {
		const url = new URL(value, 'https://example.com');
		const path = url.pathname;

		if (!path.startsWith('/')) return null;
		if (path.startsWith('/api/')) return null;
		if (path.length > 300) return null;

		return path.endsWith('/') ? path : `${path}/`;
	} catch {
		return null;
	}
}
