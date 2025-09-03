type Handler = (params: Record<string, string>, payload: any) => void;

export class TopicRouter {
	private routes: {
		pattern: string;
		regex: RegExp;
		keys: string[];
		handler: Handler;
	}[] = [];

	register(pattern: string, handler: Handler) {
		// Convert "match-{id}" → /^match-(?<id>[^/]+)$/
		const keys: string[] = [];
		const regexString = pattern.replace(/\{(\w+)\}/g, (_, key) => {
			keys.push(key);
			return `([^/]+)`; // capture group
		});
		const regex = new RegExp(`^${regexString}$`);

		this.routes.push({ pattern, regex, keys, handler });
	}

	dispatch(topic: string, action: string, payload: any) {
		for (const { regex, keys, handler } of this.routes) {
			const match = topic.match(regex);
			if (match) {
				const params: Record<string, string> = {};
				keys.forEach((key, i) => (params[key] = match[i + 1]));
				handler(params, payload);
				return true;
			}
		}
		console.warn("No route for topic:", topic);
		return false;
	}
}
