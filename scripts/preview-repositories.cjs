function previewPrefix(repository) {
	switch (repository) {
		case 'BUCT-WIKI/buct-wiki': return 'pr-';
		case 'BUCT-WIKI/buct-wiki-content': return 'content-pr-';
		default: throw new Error(`Unsupported preview repository: ${repository}`);
	}
}

module.exports = { previewPrefix };
