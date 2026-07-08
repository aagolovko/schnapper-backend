import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import * as dotenv from 'dotenv-flow';
import { OAuth2Client } from 'google-auth-library';
import { connectToDatabase, getArticlesCollection, getSearchProfilesCollection } from './services/database.service.js';
import { ObjectId } from 'mongodb';
import { getCrawlerStatus, triggerCrawlerRun } from './services/crawler-k8s.service.js';
dotenv.config();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const PORT = parseInt(process.env.PORT || '4000');
const googleAuthClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : undefined;
function parseKeywords(input) {
    return input
        .split(/\r?\n/)
        .map((k) => k.trim())
        .filter((k) => k.length > 0);
}
function getPriceSortKey(price) {
    const normalized = price?.trim() || '';
    if (!normalized) {
        return Number.MAX_SAFE_INTEGER;
    }
    if (/^VB$/i.test(normalized)) {
        return 0;
    }
    const numericPart = normalized.replace(/[^\d]/g, '');
    const numericValue = numericPart ? Number.parseInt(numericPart, 10) : Number.MAX_SAFE_INTEGER;
    if (Number.isNaN(numericValue)) {
        return Number.MAX_SAFE_INTEGER;
    }
    return numericValue;
}
function compareArticlesByPrice(a, b) {
    const priceA = getPriceSortKey(a.price);
    const priceB = getPriceSortKey(b.price);
    return priceA - priceB;
}
function verifyAuth(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return { isAuthenticated: false, error: 'No authorization header' };
    }
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        return { isAuthenticated: false, error: 'Invalid authorization header format' };
    }
    const token = match[1].trim();
    if (!token) {
        return { isAuthenticated: false, error: 'Missing bearer token' };
    }
    try {
        jwt.verify(token, JWT_SECRET);
        return { isAuthenticated: true };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown token verification error';
        return { isAuthenticated: false, error: `Invalid token: ${message}` };
    }
}
function authMiddleware(req, res, next) {
    req.auth = verifyAuth(req);
    next();
}
function issueAppJwt(user) {
    return jwt.sign({
        sub: user.sub,
        email: user.email,
        name: user.name,
        picture: user.picture,
        provider: 'google',
    }, JWT_SECRET, { expiresIn: '7d' });
}
async function getArticles(bounds) {
    const articlesCollection = getArticlesCollection();
    const filter = {
        $and: [
            { $nor: [{ isIgnored: true }] },
            { $or: [{ isFavorite: true }, { isFavorite: null }] },
        ],
    };
    let found;
    if (bounds) {
        const filterBounded = {
            $and: [
                filter,
                { 'locationGeocoded.latitude': { $gt: bounds._southWest.lat } },
                { 'locationGeocoded.latitude': { $lt: bounds._northEast.lat } },
                { 'locationGeocoded.longitude': { $gt: bounds._southWest.lng } },
                { 'locationGeocoded.longitude': { $lt: bounds._northEast.lng } },
            ],
        };
        found = articlesCollection.find(filterBounded);
    }
    else {
        found = articlesCollection.find(filter);
    }
    const dbArticles = await found.toArray();
    return dbArticles
        .sort(compareArticlesByPrice)
        .map((it) => ({
        ...it,
        id: it._id.toString(),
        href: `https://www.kleinanzeigen.de/${it.href}`,
        title: it.title,
        price: it.price,
        priceEur: it.priceEur ? it.priceEur : 0,
        isFavorite: it.isFavorite ? true : false,
        hrefImage: it.hrefImage,
        location: it.location,
        createdOn: it.createdOn,
        searchKeywords: it.searchKeywords,
        locationGeocoded: {
            latitude: it.locationGeocoded?.latitude,
            longitude: it.locationGeocoded?.longitude,
        },
    }));
}
async function updateArticle(id, update) {
    const articlesCollection = getArticlesCollection();
    await articlesCollection.updateOne({ _id: ObjectId.createFromHexString(id) }, update);
    const found = articlesCollection.find({
        _id: ObjectId.createFromHexString(id),
    });
    const updated = (await found.toArray())
        .map((it) => ({ ...it, id: it._id.toString() }))
        .shift();
    return updated;
}
async function main() {
    await connectToDatabase();
    const app = express();
    app.use(express.json());
    app.use(cors({
        origin: process.env.CORS_ORIGIN || 'http://localhost:4201',
        credentials: true,
    }));
    app.use(authMiddleware);
    app.post('/api/auth/google', async (req, res) => {
        try {
            const credential = req.body.credential?.trim();
            if (!credential) {
                return res.status(400).json({ error: 'Google credential is required' });
            }
            if (!googleAuthClient) {
                return res.status(500).json({ error: 'Google client is not configured' });
            }
            const ticket = await googleAuthClient.verifyIdToken({
                idToken: credential,
                audience: GOOGLE_CLIENT_ID,
            });
            const payload = ticket.getPayload();
            if (!payload?.sub) {
                return res.status(401).json({ error: 'Invalid Google credential' });
            }
            const user = {
                sub: payload.sub,
                email: payload.email,
                name: payload.name,
                picture: payload.picture,
            };
            const token = issueAppJwt(user);
            res.json({ token, user });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown Google auth error';
            console.error('Google login failed:', err);
            res.status(401).json({ error: `Google sign-in failed: ${message}` });
        }
    });
    // GET /api/articles - get all articles
    app.get('/api/articles', async (req, res) => {
        try {
            const articles = await getArticles();
            res.json(articles);
        }
        catch (err) {
            console.error('Error fetching articles:', err);
            res.status(500).json({ error: 'Failed to fetch articles' });
        }
    });
    // GET /api/articles/bounded - get articles within bounds
    app.get('/api/articles/bounded', async (req, res) => {
        try {
            const bounds = req.query.bounds ? JSON.parse(req.query.bounds) : undefined;
            const articles = await getArticles(bounds);
            res.json(articles);
        }
        catch (err) {
            console.error('Error fetching bounded articles:', err);
            res.status(500).json({ error: 'Failed to fetch articles' });
        }
    });
    // POST /api/articles/:id/favorite - mark article as favorite
    app.post('/api/articles/:id/favorite', async (req, res) => {
        try {
            if (!req.auth?.isAuthenticated) {
                return res.status(401).json({ error: 'Unauthorized: ' + req.auth?.error });
            }
            console.log(`Mark article as favorite: ${req.params.id}`);
            const updated = await updateArticle(req.params.id, { $set: { isFavorite: true } });
            res.json(updated);
        }
        catch (err) {
            console.error('Error updating article:', err);
            res.status(500).json({ error: 'Failed to update article' });
        }
    });
    // DELETE /api/articles/by-keyword/:keyword - mark a keyword as disabled in profiles and delete matching articles
    app.delete('/api/articles/by-keyword/:keyword', async (req, res) => {
        try {
            if (!req.auth?.isAuthenticated) {
                return res.status(401).json({ error: 'Unauthorized: ' + req.auth?.error });
            }
            const keyword = decodeURIComponent(req.params.keyword || '').trim();
            if (!keyword) {
                return res.status(400).json({ error: 'Keyword is required' });
            }
            console.log(`Delete articles by keyword: ${keyword}`);
            const profiles = await getSearchProfilesCollection()
                .find({ keywords: keyword })
                .toArray();
            let updatedProfiles = 0;
            for (const profile of profiles) {
                const nextKeywords = (profile.keywords || []).map((item) => item === keyword ? `-${keyword}` : item);
                const updateResult = await getSearchProfilesCollection().updateOne({ _id: profile._id }, { $set: { keywords: nextKeywords } });
                updatedProfiles += updateResult.modifiedCount;
            }
            const result = await getArticlesCollection().deleteMany({
                searchKeywords: keyword,
            });
            res.json({
                keyword,
                deleted: true,
                deletedCount: result.deletedCount,
                removedFromProfiles: updatedProfiles,
            });
        }
        catch (err) {
            console.error('Error deleting articles by keyword:', err);
            res.status(500).json({ error: 'Failed to delete articles by keyword' });
        }
    });
    // POST /api/articles/:id/ignore - mark article as ignored
    app.post('/api/articles/:id/ignore', async (req, res) => {
        try {
            if (!req.auth?.isAuthenticated) {
                return res.status(401).json({ error: 'Unauthorized: ' + req.auth?.error });
            }
            console.log(`Mark article as ignored: ${req.params.id}`);
            const updated = await updateArticle(req.params.id, { $set: { isIgnored: true } });
            res.json(updated);
        }
        catch (err) {
            console.error('Error updating article:', err);
            res.status(500).json({ error: 'Failed to update article' });
        }
    });
    // DELETE /api/articles/:id - remove article from the database
    app.delete('/api/articles/:id', async (req, res) => {
        try {
            if (!req.auth?.isAuthenticated) {
                return res.status(401).json({ error: 'Unauthorized: ' + req.auth?.error });
            }
            console.log(`Delete article: ${req.params.id}`);
            const result = await getArticlesCollection().deleteOne({
                _id: ObjectId.createFromHexString(req.params.id),
            });
            if (!result.deletedCount) {
                return res.status(404).json({ error: 'Article not found' });
            }
            res.json({ id: req.params.id, deleted: true });
        }
        catch (err) {
            console.error('Error deleting article:', err);
            res.status(500).json({ error: 'Failed to delete article' });
        }
    });
    // GET /api/search-profiles - list all search profiles
    app.get('/api/search-profiles', async (req, res) => {
        try {
            const profiles = await getSearchProfilesCollection().find({}).toArray();
            const formatted = profiles.map((p) => ({
                id: p._id.toString(),
                title: p.title,
                keywords: p.keywords || [],
                isActive: p.isActive || false,
                notes: p.notes,
                searchSchedule: p.searchSchedule,
                maxPrice: p.maxPrice,
                locations: p.locations,
            }));
            res.json(formatted);
        }
        catch (err) {
            console.error('Error fetching search profiles:', err);
            res.status(500).json({ error: 'Failed to fetch search profiles' });
        }
    });
    // PUT /api/search-profiles/:id - update search profile
    app.put('/api/search-profiles/:id', async (req, res) => {
        try {
            const { title, keywords, isActive } = req.body;
            const profileId = req.params.id;
            const update = {};
            if (title !== undefined)
                update.title = title;
            if (keywords !== undefined)
                update.keywords = Array.isArray(keywords) ? keywords : parseKeywords(keywords);
            if (isActive !== undefined)
                update.isActive = isActive;
            console.log(`Updating search profile ${profileId}:`, update);
            const profile = await getSearchProfilesCollection().findOneAndUpdate({ _id: new ObjectId(profileId) }, { $set: update }, { returnDocument: 'after' });
            if (!profile) {
                return res.status(404).json({ error: 'Profile not found' });
            }
            res.json({
                id: profile._id.toString(),
                title: profile.title,
                keywords: profile.keywords || [],
                isActive: profile.isActive || false,
                notes: profile.notes,
                searchSchedule: profile.searchSchedule,
                maxPrice: profile.maxPrice,
                locations: profile.locations,
            });
        }
        catch (err) {
            console.error('Error updating search profile:', err);
            res.status(500).json({ error: 'Failed to update search profile' });
        }
    });
    // POST /api/search-profiles - create new search profile
    app.post('/api/search-profiles', async (req, res) => {
        try {
            const { title, keywords, isActive } = req.body;
            if (!title) {
                return res.status(400).json({ error: 'Title is required' });
            }
            const newProfile = {
                title,
                keywords: Array.isArray(keywords) ? keywords : (keywords ? parseKeywords(keywords) : []),
                isActive: isActive || false,
                notes: '',
                searchSchedule: '*',
                maxPrice: null,
                locations: [],
            };
            console.log(`Creating new search profile: ${title}`);
            const result = await getSearchProfilesCollection().insertOne(newProfile);
            res.status(201).json({
                id: result.insertedId.toString(),
                title: newProfile.title,
                keywords: newProfile.keywords,
                isActive: newProfile.isActive,
                notes: newProfile.notes,
                searchSchedule: newProfile.searchSchedule,
                maxPrice: newProfile.maxPrice,
                locations: newProfile.locations,
            });
        }
        catch (err) {
            console.error('Error creating search profile:', err);
            res.status(500).json({ error: 'Failed to create search profile' });
        }
    });
    // DELETE /api/search-profiles/:id - delete search profile
    app.delete('/api/search-profiles/:id', async (req, res) => {
        try {
            const profileId = req.params.id;
            console.log(`Deleting search profile ${profileId}`);
            const deletedProfile = await getSearchProfilesCollection().findOneAndDelete({
                _id: new ObjectId(profileId),
            });
            if (!deletedProfile) {
                return res.status(404).json({ error: 'Profile not found' });
            }
            res.json({ message: 'Profile deleted successfully', id: profileId });
        }
        catch (err) {
            console.error('Error deleting search profile:', err);
            res.status(500).json({ error: 'Failed to delete search profile' });
        }
    });
    app.get('/api/crawling/status', async (req, res) => {
        try {
            const crawlerStatus = await getCrawlerStatus();
            res.json(crawlerStatus);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown crawler status error';
            console.error('Error fetching crawler status:', err);
            res.status(503).json({ error: `Failed to fetch crawler status: ${message}` });
        }
    });
    app.post('/api/crawling/run', async (req, res) => {
        try {
            if (!req.auth?.isAuthenticated) {
                return res.status(401).json({ error: 'Unauthorized: ' + req.auth?.error });
            }
            const runResult = await triggerCrawlerRun();
            res.status(201).json(runResult);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown crawler trigger error';
            console.error('Error starting crawler:', err);
            res.status(503).json({ error: `Failed to start crawler: ${message}` });
        }
    });
    // Health check
    app.get('/health', (req, res) => {
        res.json({ status: 'ok' });
    });
    app.listen(PORT, () => {
        console.log(`🚀 Server ready at http://0.0.0.0:${PORT}`);
    });
}
main().catch(console.error);
