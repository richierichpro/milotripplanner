// Shared shapes for everything Milo finds, plans and checks.

/** One SerpApi call, as listed under "See sources". */
export type CallLogEntry = {
  engine: string;
  summary: string;
  source: "live" | "cache" | "demo";
  ms: number;
  at: string;
};

/** Where a result came from and when it was fetched. */
export type Source = { engine: string; url?: string; fetchedAt: string };

// ---------- Search results ----------

export type Flight = {
  id: string;
  source: Source;
  from: string;
  to: string;
  /** "YYYY-MM-DD HH:MM", local time at the airport. */
  departTime: string;
  arriveTime: string;
  airline: string;
  airlineLogo?: string;
  flightNumbers: string[];
  stops: number;
  /** Layover airports, e.g. ["BLR"]. */
  via: string[];
  durationMin: number;
  pricePerPerson: number;
};

export type Hotel = {
  id: string;
  source: Source;
  name: string;
  lat: number;
  lng: number;
  pricePerNight?: number;
  rating?: number;
  reviews?: number;
  stars?: number;
  thumbnail?: string;
  amenities: string[];
  link?: string;
  /** As Google Hotels writes it, e.g. "12:00 PM". */
  checkInTime?: string;
  checkOutTime?: string;
};

export type TicketOption = { title: string; price: number; priceText: string; link?: string; official?: boolean };
export type TourOption = { title: string; price: number; priceText: string; link?: string; provider?: string; rating?: number; reviews?: number };

/** Prices from a Google Maps place-details lookup. */
export type PlacePrices = {
  source: Source;
  /** Entry tickets, cheapest first. */
  admission: TicketOption[];
  /** Optional bookable tours, cheapest first. */
  tours: TourOption[];
  /** Typical spend per person, e.g. "₹400–800". */
  priceRange?: string;
};

export type Place = {
  id: string;
  source: Source;
  name: string;
  category?: string;
  lat: number;
  lng: number;
  rating?: number;
  reviews?: number;
  priceLevel?: string;
  address?: string;
  hours?: string;
  thumbnail?: string;
  description?: string;
  mapsUrl: string;
  /** Google's open state, e.g. "Open · Closes 10 pm" or "Temporarily closed". */
  status?: string;
  /** Opening hours keyed by lowercase weekday: { friday: "9 am–8 pm" }. */
  operatingHours?: Record<string, string>;
  prices?: PlacePrices;
};

export type Event = {
  id: string;
  source: Source;
  title: string;
  dateText?: string;
  /** "YYYY-MM-DD" when the date could be read. */
  date?: string;
  venue?: string;
  address?: string;
  link?: string;
  thumbnail?: string;
};

export type Destination = {
  id: string;
  name: string;
  country?: string;
  lat?: number;
  lng?: number;
  airportCode?: string;
  /** Round trip per person: Travel Explore prices both legs together. */
  flightPrice?: number;
  /** Not returned for India searches, so never relied on. */
  hotelPrice?: number;
  startDate?: string;
  endDate?: string;
  thumbnail?: string;
  airline?: string;
  stops?: number;
  source: Source;
};

// ---------- Trips and plans ----------

export type Person = { name: string; city: string };

export type TripInput = {
  squad: Person[];
  destination: string;
  startDate: string;
  endDate: string;
  interests: string[];
  budgetPerPerson?: number;
};

export type FlightPick = { person: string; city: string; out?: Flight; back?: Flight };

/** `why` is Milo's note; code checks it only uses facts from the item's own data. */
export type Stop = ({ kind: "place"; item: Place } | { kind: "event"; item: Event }) & {
  time: string;
  why: string;
  /** Travel from the previous stop or the hotel, e.g. "18 min by car (Google Maps)". */
  hop?: string;
  hopMinutes?: number;
  /** "hours not listed" when Google has no hours for that day. */
  hoursNote?: string;
};

/** Arrivals, check-in and leave-for-the-airport rows on a day card. */
export type Logistics = { time: string; label: string; at: "start" | "end" };

export type Day = {
  date: string;
  title: string;
  stops: Stop[];
  approxKm?: number;
  logistics?: Logistics[];
  leaveBy?: string;
  travelMinutes?: number;
  /** Local sunset "HH:MM" from suncalc. */
  sunset?: string;
};

export type Verification = { total: number; verified: number; removed: string[] };

export type CostLine = { person: string; flights: number; hotelShare: number; total: number };

export type Itinerary = {
  title: string;
  summary: string;
  trip: TripInput;
  flights: FlightPick[];
  arrivalWindow?: { first: string; last: string; extraVsCheapest: number };
  hotel?: Hotel;
  hotelDistanceKm?: number;
  rooms: number;
  nights: number;
  days: Day[];
  verification: Verification;
  costs: CostLine[];
  createdAt: string;
};

// ---------- People and their limits ----------

/** Hard limits are never broken without that person's OK; soft ones are preferences. */
export type Constraint = { id: string; hard: boolean; sourceMessageId?: number; waived?: string } & (
  | { kind: "budget"; max: number }
  | { kind: "dates"; start: string; end: string }
  | { kind: "food"; diet: "veg" | "jain" | "vegan" | "no_beef" | "allergy"; detail?: string }
  /** A departure window, optionally for one leg and one day. */
  | { kind: "flight_time"; direction: "out" | "back" | "any"; date?: string; notBefore?: string; notAfter?: string; reason?: string }
  | { kind: "must_do"; what: string }
  | { kind: "no_go"; what: string }
  | { kind: "vibe"; what: string }
);

export type SquadMember = {
  /** Telegram user id as a string, or "name:<slug>" for a friend someone else added. */
  id: string;
  name: string;
  city?: string;
  telegramUserId?: number;
  /** Telegram id of whoever answers and votes for this friend. */
  proxyFor?: string;
  constraints: Constraint[];
  /** Answers that aren't limits ("no limit", "non-veg"), shown on the squad card. */
  noted?: { budget?: string; food?: string };
};

/** A candidate that was left out, and why. */
export type Drop = { id: string; name: string; kind: "place" | "event" | "hotel" | "flight"; reason: string };
