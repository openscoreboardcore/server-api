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
	// { "type": "publish", "topic": "match-N2213", "message": {"homeTeam": {"name": "team1", "score": 0}, "awayTeam": {"name": "team2", "score": 0}, "status": "in_progress", "time": 120, "part": "Kwart 1" }}
);

topicRouter.register("scoreBoard-{id}", (params, payload) =>
	console.log("scoreBoard message", params, payload)
);

export default topicRouter;
