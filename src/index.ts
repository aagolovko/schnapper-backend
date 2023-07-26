import {ApolloServer} from '@apollo/server';
import {startStandaloneServer} from '@apollo/server/standalone';
import {collections, connectToDatabase} from "./services/database.service.ts";
import {articles} from "./articles.mock.ts";
import {ObjectId} from "mongodb";

// A schema is a collection of type definitions (hence "typeDefs")
// that together define the "shape" of queries that are executed against
// your data.
const typeDefs = `#graphql
                        # Comments in GraphQL strings (such as this one) start with the hash (#) symbol.
                        
                        type GeoLocation {
                            lat: String,
                            long: String,
                        }
                        
                        scalar Date
                        
                        # This "Book" type defines the queryable fields for every book in our data source.
                        type Article {
                            href: String,
                            title: String,
                            id: ID!,
                            price: String,
                            location: String,
                            isShipping: String,
                            locationGeocoded: GeoLocation,
                            notes: String,
                            isFavorite: Boolean,
                            isIgnored: Boolean,
                            createdOn: Date,
                        }
                        
                        type Query {
                            articles: [Article]
                            article(id: ID!): Article
                        
                        }
                        
                        input ArticleUpdate {
                            isFavorite: Boolean,
                        }
                        
                        # TODO: move to separate file like here: https://github.com/graphql-boilerplates/typescript-graphql-server/blob/master/advanced/src/schema.graphql
                        type Mutation {
                            updateArticle(id: ID!, article: ArticleUpdate): Article
                            ignoreArticle(id: ID!): Article
                        }
`;

interface ArticleUpdate {
    isFavorite: boolean,
}

const client = await connectToDatabase()

// Resolvers define how to fetch the types defined in your schema.
// This resolver retrieves books from the "books" array above.
const resolvers = {
    Query: {
        articles: async () => {
            const found = await collections.articles.find({isIgnored: null})
            const dbArticles = (await found.toArray());

            // await client.close()

            return dbArticles.map( it => {
                    return { id: it._id.toString(), href: it.href, title: it.title, locationGeocoded: {lat: it.locationGeocoded?.latitude, long: it.locationGeocoded?.longitude}}
                }
            )
        },
        article: (parent, args) => {
            console.log(`ID param: ${args.id}`)
            return articles.filter(it => it.id === args.id).shift()
        },
    },
    Mutation: {
        // parent, args
        updateArticle: (parent, args) => {
            console.log(`Updating: ${args.id} ${JSON.stringify(args.article)}`)
            return articles.filter(it => it.id === args.id).shift()
        },
        ignoreArticle: async (parent, args) => {
            console.log(`Updating: ${args.id}}`)

            // const client = await connectToDatabase()

            await collections.articles.updateOne({_id: ObjectId.createFromHexString(args.id)}, { $set: { isIgnored: true } })

            const found = await collections.articles.find({_id: ObjectId.createFromHexString(args.id)})
            const updated = (await found.toArray()).map( it => {
                return { id: it._id, ...it}
            }).shift()

            // await client.close()
            return updated
        }

    }
};


// The ApolloServer constructor requires two parameters: your schema
// definition and your set of resolvers.
const server = new ApolloServer({
    typeDefs,
    resolvers,
});

// Passing an ApolloServer instance to the `startStandaloneServer` function:
//  1. creates an Express app
//  2. installs your ApolloServer instance as middleware
//  3. prepares your app to handle incoming requests
const {url} = await startStandaloneServer(server, {
    listen: {port: 4000},
});

console.log(`🚀  Server ready at: ${url}`);





