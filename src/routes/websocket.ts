// List of websocket topics.
import { TopicRouter } from "@/lib/ws/TopicRouter";

const topicRouter = new TopicRouter();

// Register
topicRouter.register(
	"match-{id}",
	(params, payload) =>
		// MatchController.handleMessage(params, payload)
		console.log("match message", params, payload)
	// { "type": "subscribe", "topic": "match-N2213" }
	// { "type": "publish", "topic": "match-N2213", "message": "test" }
	// { "type": "publish", "topic": "match-N2213", "message": {"homeTeam": "team1", "awayTeam": "team2", "status": "in_progress", "time": 120, "score": {"home": 1, "away": 2}}, "part": "Kwart 1" }
);

export default topicRouter;
