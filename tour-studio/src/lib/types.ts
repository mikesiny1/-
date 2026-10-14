export type StyleId =
  | 'modern'
  | 'scandi'
  | 'japandi'
  | 'industrial'
  | 'mediterranean'
  | 'classic'
  | 'boho';

export type RoomType =
  | 'living'
  | 'kitchen'
  | 'dining'
  | 'bedroom'
  | 'master'
  | 'kids'
  | 'office'
  | 'mamad'
  | 'bathroom'
  | 'balcony'
  | 'hall'
  | 'storage';

export type ProjectStatus = 'draft' | 'in_progress' | 'ready' | 'sent';

export type Household = 'single' | 'couple' | 'family' | 'investor';
export type Budget = 'smart' | 'mid' | 'premium';

export interface PropertyDetails {
  title: string;
  address: string;
  city: string;
  rooms: number;
  sqm: number;
  floor: string;
  price: string;
  dealType: 'sale' | 'rent';
  description: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
}

export interface PlanRoom {
  id: string;
  type: RoomType;
  name: string;
  /** seed point in working-image pixels */
  sx: number;
  sy: number;
  /** manually outlined room (working px) – used when the plan reader could not find it */
  rect?: { x0: number; y0: number; x1: number; y1: number };
}

export interface PlanSettings {
  /** working-image pixels per meter */
  pxPerM: number;
  /** grayscale threshold (0-255) under which a pixel counts as wall ink */
  threshold: number;
  /** minimal wall thickness in working px – thinner strokes are ignored */
  minWall: number;
  /** doorway gap (meters) closed when separating rooms */
  doorGap: number;
  rooms: PlanRoom[];
  calibrated: boolean;
  /** thin drawn lines (glazing, door leaves) also separate rooms */
  thinLines?: boolean;
  /** close double-line (unfilled) walls up to this thickness, metres */
  fillOutline?: number;
  /** where the scale came from */
  scaleSource?: 'doors' | 'area' | 'guess' | 'manual';
  /** room names read off the plan (OCR), in working-image pixels */
  labels?: { type: RoomType; text: string; x: number; y: number }[];
}

export type FurnitureKind =
  | 'sofa'
  | 'armchair'
  | 'coffeeTable'
  | 'rug'
  | 'tvUnit'
  | 'diningTable'
  | 'bed'
  | 'nightstand'
  | 'wardrobe'
  | 'desk'
  | 'plant'
  | 'floorLamp'
  | 'sideboard'
  | 'singleBed'
  | 'bistroSet'
  | 'shelf'
  | 'art';

export interface StagedItem {
  id: string;
  kind: FurnitureKind;
  /** 0 = front, 1 = turned right, 2 = turned left */
  view: 0 | 1 | 2;
  /** position of item's base-centre, relative 0..1 of photo */
  x: number;
  y: number;
  /** width as fraction of photo width */
  w: number;
}

export interface PhotoEntry {
  id: string;
  blobId: string;
  roomType: RoomType;
  caption: string;
  staged: StagedItem[];
}

export interface DesignBrief {
  furnish: boolean;
  style: StyleId;
  household: Household;
  budget: Budget;
  light: 'day' | 'evening';
  /** what the windows look out on */
  view?: 'nature' | 'sea' | 'city';
}

export interface ShareLog {
  at: number;
  channel: 'whatsapp' | 'email' | 'download' | 'share';
  note: string;
}

export interface Project {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: ProjectStatus;
  details: PropertyDetails;
  planBlobId: string | null;
  plan: PlanSettings | null;
  photos: PhotoEntry[];
  design: DesignBrief;
  coverBlobId: string | null;
  shares: ShareLog[];
  /** photo of the building with the flat's window marked (0..1), for the speed-ramp reel */
  exterior?: { blobId: string; x: number; y: number } | null;
}

export interface Brand {
  agencyName: string;
  agentName: string;
  agentPhone: string;
  agentEmail: string;
  license: string;
  accent: string;
  logoBlobId: string | null;
}
