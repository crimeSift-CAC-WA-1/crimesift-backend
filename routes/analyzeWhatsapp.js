// routes/analyzeWhatsapp.js
"use strict";

const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");
const { getAIModel, uploadFileToAI, deleteAIFile } = require("../utils/aiClient");

module.exports = async function (fastify, opts) {
  fastify.register(require("@fastify/multipart"));

  fastify.post("/analyzeWhatsapp", async (req, reply) => {
    logger.info("Received /analyzeWhatsapp request");
    try {
      const data = await req.file();
      const { time, prompt } = data.fields;

      if (!time || !prompt || !data) {
        logger.error("Missing required fields");
        return reply.badRequest("Missing required fields");
      }

      const timestamp = parseInt(time.value);
      const userPrompt = prompt.value;
      logger.debug(`Timestamp: ${timestamp}, Prompt: ${userPrompt}`);

      // Save uploaded file temporarily
      const chatFilePath = path.join(
        __dirname,
        `./uploads/${Date.now()}_${data.filename}`
      );
      const writeStream = fs.createWriteStream(chatFilePath);

      await new Promise((resolve, reject) => {
        data.file.pipe(writeStream);
        data.file.on("end", resolve);
        data.file.on("error", reject);
      });
      logger.info(`File saved to ${chatFilePath}`);

      // Read chat data
      const chatData = fs.readFileSync(chatFilePath, "utf-8");
      logger.debug(`Chat data length: ${chatData.length}`);

      // Prepare AI prompt
      const systemInstruction = `
You are a professional detective's assistant. You will be given WhatsApp chat data in the following format:

[date, time] username: message

Your task is to analyze the chat data based on the following prompt:

"${userPrompt}"

IMPORTANT INSTRUCTIONS:

- **ONLY OUTPUT THE JSON ARRAY** as specified below.
- Do **NOT** include any code fences, headers, footers, explanations, or any additional text.
- **Limit the number of messages in "context-before" and "context-after" to between 3 and 10 messages each.**
- Ensure that your response is **valid JSON** and follows the exact structure provided.
- YOUR MAXIUMIM INSTACES YOUR ALLOWED TO LIST IS 10

JSON Array Format:

[
  {
    "instance_ID": 1,
    "context-before": [
      // Include up to 5 messages before the flagged instance
      {
        "time": 1729284750,
        "author": "username",
        "message": "message"
      }
      // ... up to 5 messages
    ],
    "flagged": [
      // Messages that meet the criteria specified in the user prompt
      {
        "time": 1729284750,
        "author": "username",
        "message": "message"
      },
        // ONLY ONE FLAGGED MESSAGE
        {
        "time": 0000000,
        "author": "AI-ANALYZER",
        "message": "why this message is flagged" // Explain why this message is flagged
        }
    ],
    "context-after": [
      // Include up to 5 messages after the flagged instance
      {
        "time": 1729284750,
        "author": "username",
        "message": "message"
      }
      // ... up to 5 messages
    ]
  }
  // ... more instances
]

**Remember:**

- Do **NOT** include any Markdown formatting, code fences (like \`\`\`), or additional explanations.
- I AM ITTERATING AGAIN DO **NOT** INCLUDE ANY CODE FENCES, HEADERS, FOOTERS, OR ANY ADDITIONAL TEXT EXECPT FOR WHAT IS ASKED FROM YOU ABOVE
- **ONLY OUTPUT THE JSON ARRAY.**
- **MAKE SURE TO PORPERLY ESCAPE DOUBLE QUOTES IN YOUR JSON STRINGS WITH A \\\".**

`;

      const model = getAIModel(systemInstruction);
      logger.info("AI model initialized");

      // Upload chat file to AI
      const uploadedFile = await uploadFileToAI(
        chatFilePath,
        "text/plain",
        "WhatsApp Chat Data"
      );
      logger.info(`File uploaded to AI: ${uploadedFile.uri}`);

      // Generate content
      let result;
      try {
        result = await model.generateContent([
          {
            fileData: {
              mimeType: uploadedFile.mimeType,
              fileUri: uploadedFile.uri,
            },
          },
          { text: userPrompt },
        ]);
        logger.info("AI content generation completed");
      } catch (aiError) {
        logger.error("Error during AI content generation:", aiError);
        logger.error("AI Error Details:", JSON.stringify(aiError, Object.getOwnPropertyNames(aiError), 2));
        throw aiError;
      }

      // Parse AI response
      const aiResponse = await result.response.text();
      logger.info("Raw AI Response:");
      logger.info(aiResponse);

      // Sanitize the AI response
      let jsonString = aiResponse.trim();

      // Remove any code fences or extraneous text
      jsonString = jsonString.replace("```json", "").replace(/```/g, "").trim();

      // Extract JSON content
      const jsonStart = jsonString.indexOf("[");
      const jsonEnd = jsonString.lastIndexOf("]") + 1;
      jsonString = jsonString.substring(jsonStart, jsonEnd);

      let analysisResults;
      try {
        analysisResults = JSON.parse(jsonString);
        logger.info("AI response parsed successfully");
      } catch (parseError) {
        logger.error("JSON Parsing Error:", parseError);
        logger.error("Sanitized AI Response:", jsonString);
        throw new Error("Failed to parse AI response as JSON.");
      }

      // Enforce context message limits
      const MAX_CONTEXT_MESSAGES = 10;

      analysisResults = analysisResults.map((instance) => {
        instance["context-before"] = instance["context-before"].slice(-MAX_CONTEXT_MESSAGES);
        instance["context-after"] = instance["context-after"].slice(0, MAX_CONTEXT_MESSAGES);
        return instance;
      });

      // Delete uploaded file
      await deleteAIFile(uploadedFile.name);
      logger.info("Uploaded file deleted from AI");

      // Clean up local file
      fs.unlinkSync(chatFilePath);
      logger.info("Temporary file deleted");

      // Clear all files in ../uploads
      const directory = path.join(__dirname, "./uploads");
      fs.readdir(directory, (err, files) => {
        if (err) throw err;

        for (const file of files) {
          fs.unlink(path.join(directory, file), (err) => {
            if (err) throw err;
          });
        }
      });


      // Send response
      reply.send(analysisResults);
    } catch (error) {
      logger.error("Error in /analyzeWhatsapp:", error);
      logger.error("Error Details:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
      reply.internalServerError("An error occurred during analysis.");
    }
  });
};
