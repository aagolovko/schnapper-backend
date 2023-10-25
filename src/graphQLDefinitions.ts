// A schema is a collection of type definitions (hence "typeDefs")
// that together define the "shape" of queries that are executed against
// your data.
export const typeDefs = `
#graphql
# Comments in GraphQL strings (such as this one) start with the hash (#) symbol.

input LatLng {
    lat: Float!
    lng: Float!
}

input Bounds {
    _southWest: LatLng!
    _northEast: LatLng!
}

type GeoLocation {
    latitude: String,
    longitude: String,
}

scalar Date

# This "Book" type defines the queryable fields for every book in our data source.
type Article {
    href: String,
    hrefImage: String,
    title: String,
    id: ID!,
    price: String,
    priceEur: Int,
    location: String,
    isShipping: String,
    locationGeocoded: GeoLocation,
    notes: String,
    isFavorite: Boolean,
    isIgnored: Boolean,
    createdOn: Date,
    searchKeywords: [String],
}

type Query {
    articles: [Article]
    articlesBounded(bounds: Bounds!): [Article]
    article(id: ID!): Article

}

input ArticleUpdate {
    isFavorite: Boolean,
}

# TODO: move to separate file like here: https://github.com/graphql-boilerplates/typescript-graphql-server/blob/master/advanced/src/schema.graphql
type Mutation {
    updateArticle(id: ID!, article: ArticleUpdate): Article
    ignoreArticle(id: ID!): Article
    favoriteArticle(id: ID!): Article
}
`;
