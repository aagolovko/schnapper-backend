# Purge Unreviewed Articles Design

## Goal

Let an authenticated Schnapper user permanently remove all unreviewed articles
from MongoDB with one action in the UI header.

## Definition of unreviewed

An article is unreviewed when neither review flag is explicitly `true`. The
MongoDB filter is:

```js
{
  isFavorite: { $ne: true },
  isDeleted: { $ne: true },
}
```

This includes documents with missing `isFavorite` and/or `isDeleted` fields.
Records marked favoured (`isFavorite: true`) or deleted (`isDeleted: true`)
are excluded and must not be changed.

## Design

The backend exposes an authenticated, collection-level `DELETE` endpoint. It
uses `deleteMany` with the exact filter above and returns the number of
permanently removed documents.

The Angular header adds a `Purge` button, enabled only for a signed-in user. A
native confirmation dialog makes the irreversible outcome explicit. On
success, the UI shows the number removed and reloads the page so active views
cannot retain stale records. On failure, it reports an actionable error and
does not claim the purge succeeded.

## Validation

Backend tests cover the query predicate and authentication behavior. UI tests
cover confirmation, successful result display, and request failure. Production
builds for both backend and UI must succeed before the image updates are
committed and pushed.
