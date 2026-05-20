import * as mongoDB from "mongodb";
import * as dotenv from "dotenv-flow";
import {MongoClient} from "mongodb";
import {Article} from "../models/article";
import {SearchProfile} from "../models/search-profile.ts";

export const collections: {
    articles?: mongoDB.Collection<Article>,
    searchProfiles?: mongoDB.Collection<SearchProfile>
} = {};

export async function connectToDatabase(): Promise<MongoClient> {
    // Pulls in the .env.dev file so it can be accessed from process.env. No path as .env.dev is in root, the default location
    dotenv.config()

    // Create a new MongoDB client with the connection string from .env.dev
    const client = new mongoDB.MongoClient(process.env.MONGODB_URL);

    // Connect to the cluster
    await client.connect();

    // Connect to the database with the name specified in .env.dev
    const db = client.db(process.env.DB_NAME);

    // // Apply schema validation to the collection
    await applySchemaValidation(db);

    // Connect to the collection with the specific name from .env.dev, found in the database previously specified
    const articlesCollection = db.collection<Article>(process.env.ARTICLES_COLLECTION_NAME);
    const searchProfilesCollection = db.collection<SearchProfile>('searchProfiles');

    // Persist the connection to the Games collection
    collections.articles = articlesCollection;
    collections.searchProfiles = searchProfilesCollection;

    console.log(
        `Successfully connected to database: ${db.databaseName} and collections`,
    );

    return client
}

// Update our existing collection with JSON schema validation so we know our documents will always match the shape of our Game model, even if added elsewhere.
// For more information about schema validation, see this blog series: https://www.mongodb.com/blog/post/json-schema-validation--locking-down-your-model-the-smart-way
async function applySchemaValidation(db: mongoDB.Db) {
    const jsonSchema = {
        $jsonSchema: {
            bsonType: "object",
            required: ["href"],
            additionalProperties: true,
            properties: {
                title: {
                    bsonType: "string",
                    description: "'title' is required and is a string",
                },
                href: {
                    bsonType: "string",
                    description: "link to the article on the source platform",
                },
            },
        },
    };

    // Try applying the modification to the collection, if the collection doesn't exist, create it
    await db.command({
        collMod: process.env.ARTICLES_COLLECTION_NAME,
        validator: jsonSchema
    }).catch(async (error: mongoDB.MongoServerError) => {
        if (error.codeName === 'NamespaceNotFound') {
            await db.createCollection(process.env.ARTICLES_COLLECTION_NAME, {validator: jsonSchema});
        }
    });
}
