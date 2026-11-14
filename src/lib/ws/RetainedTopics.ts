const retainedTopics = new Map<string, unknown>();

export function retainTopic(topic: string, message: unknown): void {
	if (
		topic.startsWith("field-") ||
		topic.startsWith("match-") ||
		topic.startsWith("screen-")
	) {
		retainedTopics.set(topic, message);
	}
}

export function getRetainedTopic(topic: string) {
	return retainedTopics.get(topic);
}
