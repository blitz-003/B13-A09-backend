const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
dotenv.config();

const uri = process.env.MONGODB_URI;

const app = express();
const PORT = process.env.PORT;

app.use(cors());
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

const verifyToken = async (req, res, next) => {
  const authHeader = req?.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);

    req.user = {
      id: payload.sub || payload.id,
      email: payload.email,
    };

    console.log("Authenticated User ID:", req.user.id);
    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    return res.status(403).json({ message: "Forbidden" });
  }
};

async function run() {
  try {
    // await client.connect();

    const db = client.db("ideaengine");
    const ideaCollection = db.collection("ideas");
    const commentCollection = db.collection("comments");
    const destinationCollection = db.collection("destinations");
    const bookingCollection = db.collection("bookings");

    // Fetch entire platform's idea
    app.get("/ideas", async (req, res) => {
      try {
        const result = await ideaCollection.find().toArray();
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: "Failed to fetch concept indexes." });
      }
    });

    // Retrieve the top 6 highlighted validation targets for feed display
    app.get("/ideas/featured", async (req, res) => {
      try {
        const result = await ideaCollection.find().limit(6).toArray();
        res.json(result);
      } catch (err) {
        res
          .status(500)
          .json({ error: "Failed to pull featured dataset listings." });
      }
    });

    // Fetch ideas created exclusively by a specific user
    app.get("/ideas/user/:userId", verifyToken, async (req, res) => {
      try {
        const { userId } = req.params;
        const result = await ideaCollection
          .find({ creatorId: userId })
          .toArray();
        res.json(result);
      } catch (err) {
        res
          .status(500)
          .json({ error: "Failed to retrieve owned concept documents." });
      }
    });

    // Get details for a single idea entry
    app.get("/ideas/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const result = await ideaCollection.findOne({ _id: new ObjectId(id) });
        console.log("server side idea details");
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: "Failed to fetch idea details." });
      }
    });

    // Add a new idea securely to the database collection
    app.post("/add-idea", verifyToken, async (req, res) => {
      try {
        const {
          title,
          category,
          shortDescription,
          targetAudience,
          estimatedBudget,
          problem,
          solution,
          image, // <-- Extracted optional image asset URL string
        } = req.body;

        const userId = req.user?.id;
        if (!userId) {
          return res.status(401).json({
            error: "Unauthorized: Missing user identification context.",
          });
        }

        if (
          !title ||
          !category ||
          !shortDescription ||
          !targetAudience ||
          !problem ||
          !solution
        ) {
          return res
            .status(400)
            .json({ error: "Missing required core identity elements." });
        }

        // Build mapped object—all properties related to voting have been dropped cleanly
        const newIdea = {
          title,
          category,
          shortDescription,
          targetAudience,
          estimatedBudget: estimatedBudget || "N/A",
          problem,
          solution,
          image: image || "", // <-- Appended image tracking field
          creatorId: userId,
          comments: [],
          createdAt: new Date().toISOString(),
        };

        const result = await ideaCollection.insertOne(newIdea);

        res.status(201).json({
          success: true,
          message: "Concept successfully indexed.",
          insertedId: result.insertedId,
        });
      } catch (err) {
        console.error("Database Injection Error:", err);
        res
          .status(500)
          .json({ error: "Failed to allocate and add new product concept." });
      }
    });

    // my ideas route
    app.get("/my-ideas", verifyToken, async (req, res) => {
      try {
        const userId = req.user?.id;

        console.log(userId);
        console.log("inside my ideas");
        if (!userId) {
          return res
            .status(401)
            .json({ error: "Invalid identity credentials." });
        }

        const result = await ideaCollection
          .find({ creatorId: userId })
          .toArray();

        res.json(result);
      } catch (err) {
        res
          .status(500)
          .json({ error: "Failed to fetch user specific collections." });
      }
    });

    // Update full system configuration parameters for a specific idea
    app.put("/ideas/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const userId = req.user?.id;

        const {
          title,
          category,
          shortDescription,
          targetAudience,
          estimatedBudget,
          problem,
          solution,
        } = req.body;

        if (!userId) {
          return res
            .status(401)
            .json({ error: "Unauthorized access context." });
        }

        const query = { _id: new ObjectId(id) };
        const existingIdea = await ideaCollection.findOne(query);

        if (!existingIdea) {
          return res.status(404).json({ error: "Concept entry not found." });
        }

        if (existingIdea.creatorId !== userId) {
          return res.status(403).json({
            error: "Forbidden: You do not own this concept framework.",
          });
        }

        const updatedDocument = {
          $set: {
            title: title || existingIdea.title,
            category: category || existingIdea.category,
            shortDescription: shortDescription || existingIdea.shortDescription,
            targetAudience: targetAudience || existingIdea.targetAudience,
            estimatedBudget: estimatedBudget || "N/A",
            problem: problem || existingIdea.problem,
            solution: solution || existingIdea.solution,
            updatedAt: new Date().toISOString(),
          },
        };

        const result = await ideaCollection.updateOne(query, updatedDocument);

        res.json({
          success: true,
          message: "Concept metadata parameters updated successfully.",
        });
      } catch (err) {
        console.error("Database processing pipeline exception:", err);
        res
          .status(500)
          .json({ error: "Failed to compile database update array." });
      }
    });

    // UNINDEX / REMOVE PERMANENTLY FROM REGISTRY
    app.delete("/ideas/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const userId = req.user?.id;

        if (!userId) {
          return res
            .status(401)
            .json({ error: "Unauthorized access context." });
        }

        const query = {
          _id: new ObjectId(id),
          creatorId: userId,
        };

        const result = await ideaCollection.deleteOne(query);

        if (result.deletedCount === 0) {
          return res.status(404).json({
            error:
              "Target entry not found or you are not authorized to delete it.",
          });
        }

        res.json({
          success: true,
          message: "Idea permanently unindexed from core registry.",
        });
      } catch (err) {
        console.error("Delete route failure:", err);
        res.status(500).json({
          error: "Server structural compilation failure on delete sequence.",
        });
      }
    });

    // Post a comment and index it under user interactions
    app.post("/ideas/:id/comments", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const { text, userName } = req.body;
        const userId = req.user?.id;

        if (!text?.trim()) {
          return res
            .status(400)
            .json({ error: "Comment text cannot be empty." });
        }

        const commentId = `c-${Date.now()}`;
        const freshComment = {
          id: commentId,
          ideaId: id,
          userId,
          userName: userName || "Anonymous",
          text: text.trim(),
          timestamp: new Date()
            .toISOString()
            .replace("T", " ")
            .substring(0, 16),
        };

        const ideaResult = await ideaCollection.updateOne(
          { _id: new ObjectId(id) },
          { $push: { comments: freshComment } },
        );

        if (ideaResult.matchedCount === 0) {
          return res
            .status(404)
            .json({ error: "Target idea framework entry not found." });
        }

        await db.collection("comments").insertOne({
          _id: commentId,
          ideaId: id,
          userId,
          userName: freshComment.userName,
          text: freshComment.text,
          timestamp: freshComment.timestamp,
        });

        res.status(201).json({ success: true, comment: freshComment });
      } catch (err) {
        console.error(err);
        res
          .status(500)
          .json({ error: "Failed to persist comment token record." });
      }
    });

    // Remove comment from both structural destinations
    app.delete(
      "/ideas/:id/comments/:commentId",
      verifyToken,
      async (req, res) => {
        try {
          const { id, commentId } = req.params;
          const userId = req.user?.id;

          const ideaResult = await ideaCollection.updateOne(
            { _id: new ObjectId(id) },
            { $pull: { comments: { id: commentId, userId: userId } } },
          );

          const commentResult = await db.collection("comments").deleteOne({
            _id: commentId,
            userId: userId,
          });

          if (
            ideaResult.modifiedCount === 0 &&
            commentResult.deletedCount === 0
          ) {
            return res.status(404).json({
              error: "Comment not found or unauthorized action context.",
            });
          }

          res.json({
            success: true,
            message: "Comment successfully discarded.",
          });
        } catch (err) {
          res
            .status(500)
            .json({ error: "Database exception handling comment removal." });
        }
      },
    );

    // Get all comment interactions for the logged-in user
    app.get("/my-interactions/comments", verifyToken, async (req, res) => {
      try {
        const userId = req.user?.id;

        if (!userId) {
          return res
            .status(401)
            .json({ error: "Unauthorized access context." });
        }

        const userComments = await db
          .collection("comments")
          .find({ userId: userId })
          .sort({ timestamp: -1 })
          .toArray();

        res.json(userComments);
      } catch (err) {
        res.status(500).json({
          error: "Failed to fetch user interactions history pipeline.",
        });
      }
    });

    // PATCH: Modify an existing embedded comment document's text string
    app.patch(
      "/ideas/:id/comments/:commentId",
      verifyToken,
      async (req, res) => {
        try {
          const { id, commentId } = req.params;
          const { text } = req.body;
          const userId = req.user?.id;

          if (!text?.trim()) {
            return res
              .status(400)
              .json({ error: "Comment text cannot be blank." });
          }

          const result = await ideaCollection.updateOne(
            {
              _id: new ObjectId(id),
              "comments.id": commentId,
              "comments.userId": userId,
            },
            { $set: { "comments.$.text": text.trim() } },
          );

          if (result.modifiedCount === 0) {
            return res.status(404).json({
              error: "Comment not found or unauthorized modification access.",
            });
          }

          res.json({ success: true, text: text.trim() });
        } catch (err) {
          console.error("Edit comment error:", err);
          res
            .status(500)
            .json({ error: "Server error updating comment text index." });
        }
      },
    );

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Persistent client loop handlers
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server executing locally on port ${PORT}`);
  });
}

module.exports = app;
