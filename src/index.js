import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { collections, connectToDatabase } from './services/database.service.ts';
import { ObjectId } from 'mongodb';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const PORT = parseInt(process.env.PORT || '4000');
function verifyAuth(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return { isAuthenticated: false, error: 'No authorization header' };
    }
    const token = authHeader.replace('Bearer ', '');
    try {
        jwt.verify(token, JWT_SECRET);
        return { isAuthenticated: true };
    }
    catch (err) {
        return { isAuthenticated: false, error: `Invalid token: ${err.message}` };
    }
}
function authMiddleware(req, res, next) {
    req.auth = verifyAuth(req);
    next();
}
async function getArticles(bounds) {
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
        found = collections.articles.find(filterBounded);
    }
    else {
        found = collections.articles.find(filter);
    }
    const dbArticles = await found.toArray();
    return dbArticles.map((it) => ({
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
    await collections.articles.updateOne({ _id: ObjectId.createFromHexString(id) }, update);
    const found = collections.articles.find({
        _id: ObjectId.createFromHexString(id),
    });
    const updated = (await found.toArray())
        .map((it) => ({ id: it._id.toString(), ...it }))
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
    // GET /api/search-profiles - list all search profiles
    app.get('/api/search-profiles', async (req, res) => {
        try {
            const profiles = await collections.searchProfiles.find({}).toArray();
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
                update.keywords = Array.isArray(keywords) ? keywords : keywords.split(/[\s,]+/).filter((k) => k.trim());
            if (isActive !== undefined)
                update.isActive = isActive;
            console.log(`Updating search profile ${profileId}:`, update);
            const profile = await collections.searchProfiles.findOneAndUpdate({ _id: new ObjectId(profileId) }, { $set: update }, { returnDocument: 'after' });
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
                keywords: Array.isArray(keywords) ? keywords : (keywords ? keywords.split(/[\s,]+/).filter((k) => k.trim()) : []),
                isActive: isActive || false,
                notes: '',
                searchSchedule: '*',
                maxPrice: null,
                locations: [],
            };
            console.log(`Creating new search profile: ${title}`);
            const result = await collections.searchProfiles.insertOne(newProfile);
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
            const deletedProfile = await collections.searchProfiles.findOneAndDelete({
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
    // Health check
    app.get('/health', (req, res) => {
        res.json({ status: 'ok' });
    });
    app.listen(PORT, () => {
        console.log(`🚀 Server ready at http://0.0.0.0:${PORT}`);
    });
}
main().catch(console.error);
