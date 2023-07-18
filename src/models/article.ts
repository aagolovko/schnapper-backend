import { ObjectId } from "mongodb";

export interface Article {
    href: string;
    title?: string;
    id: ObjectId;
    price?: string;
    location: string;
    isShipping?: any;
    locationGeocoded?: any; // TODO: object has own schema, make sense to use it?
    notes?: string;
    isFavorite?: boolean; // TODO: how to fix? why is it red? default value possible?
    isIgnored?: boolean;
    createdOn: string;
}
