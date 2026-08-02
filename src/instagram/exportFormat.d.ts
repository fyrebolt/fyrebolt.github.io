// Types for exportFormat.js. The implementation is plain JavaScript so Node
// scripts and the browser bundle can share one copy of it; these declarations
// are what the TypeScript side sees.
import type { FollowEvent, Profile, Snapshot } from './data';

export declare const FOLLOWERS_RE: RegExp;
export declare const FOLLOWING_RE: RegExp;
export declare const UNFOLLOWED_RE: RegExp;

export declare function dayKey(iso: string): string;

/** One row of a followers/following file, and its first string_list_data entry. */
export declare function usernameOf(
  row: { title?: string } | undefined,
  sld: { value?: string; href?: string; timestamp?: number } | undefined,
): string | undefined;

export declare function extractEntries(json: unknown): Profile[];
export declare function collectProfiles(docs: unknown[]): Profile[];
export declare function extractUnfollowed(json: unknown): FollowEvent[];

export declare function applyDates(
  live: Profile[],
  fromExport: Profile[],
): { profiles: Profile[]; dated: number };

export declare function reconstructSnapshots(followers: Profile[]): Snapshot[];
export declare function mergeSnapshots(
  real: Snapshot[] | undefined,
  reconstructed: Snapshot[],
): Snapshot[];
export declare function mergeOutbound(
  existing: FollowEvent[] | undefined,
  incoming: FollowEvent[],
): { events: FollowEvent[]; added: number };
