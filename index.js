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
    await client.connect();

    const db = client.db("ideaengine");
    const ideaCollection = db.collection("ideas");
    const commentCollection = db.collection("comments");

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
        } = req.body;

        // 1. Double check that the middleware caught the user ID successfully
        const userId = req.user?.id;
        if (!userId) {
          return res.status(401).json({
            error: "Unauthorized: Missing user identification context.",
          });
        }

        // Field level validation verification
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

        // 2. Build document and map 'creatorId' directly from the token data
        const newIdea = {
          title,
          category,
          shortDescription,
          targetAudience,
          estimatedBudget: estimatedBudget || "N/A",
          problem,
          solution,
          creatorId: userId, // <-- INJECTING USER ID FROM JWT HERE
          votes: 0,
          createdAt: new Date().toISOString(),
        };

        const result = await ideaCollection.insertOne(newIdea);

        // Return explicit status update blocks back to user
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

    //my ideas route
    app.get("/my-ideas", verifyToken, async (req, res) => {
      try {
        // 1. Extract the unique userId from the decoded JWT payload
        const userId = req.user?.id; // Or req.user?.sub, depending on how your JWT is structured

        console.log(userId);
        console.log("inside my ideas");
        if (!userId) {
          return res
            .status(401)
            .json({ error: "Invalid identity credentials." });
        }

        // 2. Query entries matching the specific logged-in author's ID
        const result = await ideaCollection
          .find({ creatorId: userId }) // Swapped from authorEmail to authorId
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
        const userId = req.user?.id; // Secured user ID parsed from JWT middleware

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

        // 1. Target target document via explicit ObjectId tracking criteria
        const query = { _id: new ObjectId(id) };
        const existingIdea = await ideaCollection.findOne(query);

        if (!existingIdea) {
          return res.status(404).json({ error: "Concept entry not found." });
        }

        // 2. SECURITY CHECK: Verify that the requesting user is the original creator
        if (existingIdea.creatorId !== userId) {
          return res.status(403).json({
            error: "Forbidden: You do not own this concept framework.",
          });
        }

        // 3. Build the clean structural updating matrix package
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

    // 3. UNINDEX / REMOVE PERMANENTLY FROM REGISTRY
    app.delete("/ideas/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        const userId = req.user?.id; // Grab the verified user's ID from the JWT payload

        if (!userId) {
          return res
            .status(401)
            .json({ error: "Unauthorized access context." });
        }

        // FIX: Make the query look for BOTH the document ID AND the matching creatorId
        const query = {
          _id: new ObjectId(id),
          creatorId: userId,
        };

        const result = await ideaCollection.deleteOne(query);

        // If result.deletedCount is 0, it means either the idea doesn't exist,
        // OR it exists but the creatorId doesn't match the person logged in.
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

    app.get("/destination", async (req, res) => {
      const result = await destinationCollection.find().toArray();
      res.json(result);
    });

    app.post("/destination", async (req, res) => {
      const destinationData = req.body;
      console.log(destinationData);
      const result = await destinationCollection.insertOne(destinationData);

      res.json(result);
    });

    app.get("/destination/:id", verifyToken, async (req, res) => {
      const { id } = req.params;

      const result = await destinationCollection.findOne({
        _id: new ObjectId(id),
      });

      res.json(result);
    });

    app.patch("/destination/:id", async (req, res) => {
      const { id } = req.params;
      const updatedData = req.body;
      console.log(updatedData);

      const result = await destinationCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData },
      );

      res.json(result);
    });

    app.delete("/destination/:id", async (req, res) => {
      const { id } = req.params;
      const result = await destinationCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.json(result);
    });

    app.get("/booking/:userId", async (req, res) => {
      const { userId } = req.params;

      const result = await bookingCollection.find({ userId: userId }).toArray();

      res.json(result);
    });

    app.post("/booking", verifyToken, async (req, res) => {
      const bookingData = req.body;
      const result = await bookingCollection.insertOne(bookingData);

      res.json(result);
    });

    app.delete("/booking/:bookingId", verifyToken, async (req, res) => {
      const { bookingId } = req.params;
      const result = await bookingCollection.deleteOne({
        _id: new ObjectId(bookingId),
      });

      res.json(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
