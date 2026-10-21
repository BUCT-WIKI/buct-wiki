export async function requestD1Function<T>(
	endpoint: string,
	body: Record<string, unknown>
): Promise<T | null> {
	if (import.meta.env.DEV) {
		return null;
	}

	const response = await fetch(endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		throw new Error(`D1 function request failed: ${response.status}`);
	}

	return response.json() as Promise<T>;
}
