export interface SearchProfile {
    id: string;
    title: string;
    keywords: string[];
    notes: string;
    searchSchedule: string;
    maxPrice: number;
    isActive: boolean;
    locations: Location[];
}

export interface Location {
    searchArea: string;
    searchDistance: string;
    isActive: boolean;
}
