import {ApolloServer} from '@apollo/server';
import {startStandaloneServer} from '@apollo/server/standalone';
import {collections, connectToDatabase} from "./services/database.service.ts";
import {articles} from "./articles.mock.ts";
import {ObjectId} from "mongodb";
import {Bounds} from "./models/bounds";
import {typeDefs} from "./graphQLDefinitions.ts";

interface ArticleUpdate {
    isFavorite: boolean,
}

const client = await connectToDatabase()

const exampleData: Bounds = {
    _southWest: { lat: 48.051578747653444, lng: 11.407928466796877 },
    _northEast: { lat: 48.189093471714074, lng: 11.579246520996096 },
};

const resolvers = {
    Query: {
        articles: getArticles(),
        articlesBounded: getArticlesBounded(),
        article: async () => {
            return getArticle()
        }
    },
    Mutation: {
        // parent, args
        updateArticle: getUpdateArticle(),

        ignoreArticle: getIgnoreArticle(),

        favoriteArticle: getFavoriteArticle()

    }
};

function getArticlesBounded() {
    return (parent, args) => {
        return getArticles(args.bounds)
    };

}

// Resolvers define how to fetch the types defined in your schema.
async function getArticles(bounds: Bounds = undefined) {
    let filter = {
        unavailableOn: {$exists: false},
        $or: [
            {isIgnored: null},
            {isIgnored: false},
            {isFavorite: true}
        ]
    };

    let found
    if (bounds != null) {
        let filterBounded = {
            ...filter,
            $and: [
                {"locationGeocoded.latitude": {$gt: exampleData._southWest.lat}},
                {"locationGeocoded.latitude": {$lt: exampleData._northEast.lat}},
                {"locationGeocoded.longitude": {$gt: exampleData._southWest.lng}},
                {"locationGeocoded.longitude": {$lt: exampleData._northEast.lng}}
            ]
        }
        found = await collections.articles.find(filterBounded)
    } else {
        found = found = await collections.articles.find(filter)
    }

    const dbArticles = (await found.toArray());

    return dbArticles.map(it => {
            return {
                id: it._id.toString(),
                href: `https://www.kleinanzeigen.de/${it.href}`,
                title: it.title,
                price: it.price,
                priceEur: it.priceEur ? it.priceEur : 0,
                isFavorite: it.isFavorite ? true : false,
                hrefImage: it.hrefImage,
                location: it.location,
                createdOncreatedOn: it.createdOn,
                searchKeywords: it.searchKeywords,
                locationGeocoded: {latitude: it.locationGeocoded?.latitude, longitude: it.locationGeocoded?.longitude}
            }
        }
    )
}

function getArticle() {
    return (parent, args) => {
        console.log(`ID param: ${args.id}`)
        return articles.filter(it => it.id === args.id).shift()
    };
}

function getUpdateArticle() {
    return (parent, args) => {
        console.log(`Updating: ${args.id} ${JSON.stringify(args.article)}`)
        return articles.filter(it => it.id === args.id).shift()
    };
}

function getIgnoreArticle() {
    return async (parent, args) => {
        console.log(`Mark article as ignored: ${args.id}}`)

        return updateArticle(args.id, {$set: {isIgnored: true}})
    };
}

function getFavoriteArticle() {
    return async (parent, args) => {
        console.log(`Mark article as favorite: ${args.id}}`)

        return updateArticle(args.id, {$set: {isFavorite: true}})
    };
}

const updateArticle = async (id: string, update: any) => {
    await collections.articles.updateOne({_id: ObjectId.createFromHexString(id)}, update)

    const found = await collections.articles.find({_id: ObjectId.createFromHexString(id)})
    const updated = (await found.toArray()).map(it => {
        return {id: it._id, ...it}
    }).shift()

    // await client.close()
    return updated
}

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





