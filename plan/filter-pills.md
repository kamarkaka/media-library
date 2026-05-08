# Filter Pills Under Search Bar

## Overview

Add a row of pill-style filter controls below the search bar. Each filter category (genre, cast, director, maker, label) is a clickable pill that expands a dropdown of available values. Multiple values can be selected per category, and multiple categories can be active simultaneously. Filters use AND logic across categories (e.g. genre=Action AND cast=John means videos matching both).

## Current State

- Filters are single-value only: `VideoFilters` has `genre?: string`, `cast?: string`, etc.
- `applyFilters()` in `video-queries.ts` handles one value per filter.
- The old sidebar (removed) used `<select>` dropdowns with single selection.
- API endpoints `/api/genres`, `/api/cast`, etc. already return full lists of available values.
- Infinite scroll passes filters via `data-filters` JSON on the sentinel element.
- URL params currently use `?genre=X&cast=Y` (single values).

## Design

### URL format

Multi-select uses comma-separated values in query params:

```
/?genre=Action,Drama&cast=Alice,Bob&director=John&match=unmatched
```

### UI

Below the search bar, a horizontal row of pill buttons:

```
[Matched ▾]  [Genre ▾]  [Cast ▾]  [Director ▾]  [Maker ▾]  [Label ▾]    [✕ Clear all]
```

- **Inactive pill**: gray outline, just the label
- **Active pill**: filled blue/purple with count badge, e.g. `Genre (2) ▾`
- **Matched pill**: special — only two options (Matched / Unmatched), no search input, single-select (not multi)
- Clicking a pill opens a dropdown below it with checkboxes for each value
- Dropdown includes a search/filter input at the top (for long lists like cast; omitted for Matched pill)
- Selected values appear as small inline tags below the pill row, each with an ✕ to remove
- A "Clear all" link appears when any filter is active
- All filtering is client-driven: selecting/deselecting a pill value updates the URL and reloads

### Active filter tags

When filters are selected, show them as removable tags below the pill row:

```
[Genre ▾]  [Cast (2) ▾]  [Director ▾]  ...     [✕ Clear all]
Cast: [Alice ✕] [Bob ✕]
```

## Changes

### 1. Backend — make filters accept arrays

**`src/services/video-queries.ts`**:
- Change `VideoFilters` fields from `string` to `string[]`:
  ```ts
  genre?: string[];
  cast?: string[];
  director?: string[];
  maker?: string[];
  label?: string[];
  match?: 'matched' | 'unmatched';
  ```
- Update `parseVideoFilters()`: split comma-separated query params into arrays, filter empty strings; parse `match` as a simple string enum
- Update `applyFilters()`:
  - For `director`, `maker`, `label`: use `whereIn()` instead of `.where()`
  - For `genre`: use `whereIn('genres.name', genres)` in the exists subquery
  - For `cast`: use `whereIn('cast_members.name', casts)` in the exists subquery
  - For `match`:
    - `'unmatched'`: video is missing any of: `code`, `name`, `cover_image`, or has no genre or cast associations. Use `WHERE (code IS NULL OR code = '' OR name IS NULL ... OR NOT EXISTS (select from video_genres) OR NOT EXISTS (select from video_cast))`
    - `'matched'`: the inverse — all five fields are present (non-null, non-empty, and has at least one genre and one cast)

### 2. Frontend — pill filter UI

**`views/library.ejs`**:
- Add a filter pills container div between the search bar and the resume/grid section
- Server-render active filter tags from `currentFilters` so they show on initial load
- Update `data-filters` on the scroll sentinel to pass arrays instead of strings

**`public/js/library.js`**:
- Add pill rendering and dropdown toggle logic
- Fetch available values from existing API endpoints (`/api/genres`, `/api/cast`, etc.) on dropdown open
- Manage selected state: read from URL params, update URL on change
- Render active filter tags with remove buttons
- On any filter change: navigate to new URL with updated params
- Update infinite scroll to pass array filters correctly

### 3. Cleanup

**`views/library.ejs`**:
- Remove the `activeFilter` logic that merges `q`, `genre`, and `cast` into the search input — filters are now separate from search

## Files to modify

- `src/services/video-queries.ts` — array filters in interface, parser, and query builder
- `views/library.ejs` — add pill container, active tags, update sentinel data
- `public/js/library.js` — pill UI, dropdown, filter state management
- `src/routes/library.ts` — no changes needed (already passes `currentFilters` through)

## Not in scope

- Persisting filter state across sessions
- Sort controls (keep existing behavior)
- Filter counts (showing how many videos match each filter value)
