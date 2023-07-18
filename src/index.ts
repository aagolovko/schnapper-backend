import {ApolloServer} from '@apollo/server';
import {startStandaloneServer} from '@apollo/server/standalone';
import {connectToDatabase, collections} from "./services/database.service.ts";
import {Article} from "./models/article";

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
                            price: Int,
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
                        }
`;

interface ArticleUpdate {
    isFavorite: boolean,
}

const articles = [
    {
        "id": "64a50ab05f5002251c01517a",
        "href": "/s-anzeige/regentonne-regentonnen-mit-fuss/2484233637-89-19878",
        "location": "15711 Königs Wusterhausen",
        "locationGeocoded": {
            "latitude": 52.2869576,
            "longitude": 13.6148679,
        },
        "price": 30,
        "isFavorite": false,
        "isShipping": false,
        "title": "Regentonne-Regentonnen mit Fuß"
    },
    {
        "id": "64a50ab15f5002251c01517d",
        "href": "/s-anzeige/weinfass-eichenfass-wasserfass-regenfass-regentonne-wassertonne/2460093731-87-6058",
        "location": "83533 Edling",
        "locationGeocoded": {
            "latitude": 48.0575364,
            "longitude": 12.1589951,
        },
        "price": 200,
        "isShipping": false,
        "isFavorite": false,
        "title": "Weinfass Eichenfass Wasserfass Regenfass Regentonne Wassertonne"
    },
];


// Resolvers define how to fetch the types defined in your schema.
// This resolver retrieves books from the "books" array above.
const resolvers = {
    Query: {
        articles: async () => {
            const client = await connectToDatabase()
            const found = await collections.articles.find({})
            const dbArticles = (await found.toArray()).slice(0, 20);

            await client.close()

            return dbArticles.map( it => {
                    return { id: it._id.toString(), href: it.href, title: it.title}
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





