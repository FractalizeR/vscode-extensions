import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_BAR_VIEW_ID,
  ALL_VIEW_IDS,
  EXPLORER_VIEW_ID,
  locationContextKeys,
} from './location.js';

describe('locationContextKeys', () => {
  it('makes exactly one key true for a placement mode', () => {
    expect(locationContextKeys('activityBar')).toEqual({
      'projectsTree.locationIsActivityBar': true,
      'projectsTree.locationIsExplorer': false,
    });
    expect(locationContextKeys('explorer')).toEqual({
      'projectsTree.locationIsActivityBar': false,
      'projectsTree.locationIsExplorer': true,
    });
  });

  /**
  `none` must hide both views; a key left true here would leave a tree the user asked to remove.
  */
  it('makes every key false for "none"', () => {
    expect(Object.values(locationContextKeys('none'))).toEqual([false, false]);
  });

  /**
  The manifest's `when` clauses are matched against these exact names. A rename here without a
  matching manifest edit shows no tree at all, and nothing else in the suite would catch it.
  */
  it('names the keys the manifest declares', () => {
    expect(Object.keys(locationContextKeys('activityBar'))).toEqual([
      'projectsTree.locationIsActivityBar',
      'projectsTree.locationIsExplorer',
    ]);
  });
});

describe('view ids', () => {
  it('covers both declared views and keeps them distinct', () => {
    expect(ALL_VIEW_IDS).toEqual([ACTIVITY_BAR_VIEW_ID, EXPLORER_VIEW_ID]);
    expect(new Set(ALL_VIEW_IDS).size).toBe(ALL_VIEW_IDS.length);
  });
});
