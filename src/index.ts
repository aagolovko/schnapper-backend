import {ApolloServer} from '@apollo/server';
import {startStandaloneServer} from '@apollo/server/standalone';
import {collections, connectToDatabase} from "./services/database.service.ts";
import {Collection, ObjectId} from "mongodb";
import {Bounds} from "./models/bounds";
import {typeDefs} from "./graphQLDefinitions.ts";
import {Article} from "./models/article.ts";

interface ArticleUpdate {
    isFavorite: boolean,
}

const client = await connectToDatabase()

const resolvers = {
    Query: {
        articles: async () => {
            return getArticles()
        },
        // searchProfiles: async () => {
        //     return getSearchProfiles()
        // },
        articlesBounded: getArticlesBounded(),
    },
    Mutation: {
        // parent, args
        // updateArticle: updateArticle,

        ignoreArticle: getIgnoreArticle(),

        favoriteArticle: getFavoriteArticle()

    }
};

function getArticlesBounded() {
    return (parent, args) => {
        return getArticles(args.bounds)
    };

}

async function getSearchProfiles() {
    const found = collections.searchProfiles.find();
    const dbSearchProfiles = await found.toArray();

    return dbSearchProfiles.map(it => {
        return {
            id: it._id.toString(),
            title: it.title,
            keywords: it.keywords,
            notes: it.notes,
            isActive: it.isActive
        };
    });
}

// Resolvers define how to fetch the types defined in your schema.
async function getArticles(bounds: Bounds = undefined) {
    let filter = {
        $and: [
            { $nor: [{ isIgnored: true}] },
            { $or: [
                    {isFavorite: true},
                    {isFavorite: null}
                ] }
        ]
    };

    let found
    if (bounds != null) {
        let filterBounded = {
            $and: [
                filter,
                {"locationGeocoded.latitude": {$gt: bounds._southWest.lat}},
                {"locationGeocoded.latitude": {$lt: bounds._northEast.lat}},
                {"locationGeocoded.longitude": {$gt: bounds._southWest.lng}},
                {"locationGeocoded.longitude": {$lt: bounds._northEast.lng}}
            ]
        }
        found = collections.articles.find(filterBounded)
    } else {
        found = collections.articles.findOne(filter)
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

    const found = collections.articles.find({_id: ObjectId.createFromHexString(id)})
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
    listen: {port: parseInt(process.env.PORT) || 4000},
});

console.log(`🚀  Server ready at: ${url}`);





