# Story Markdown Files

This directory contains exported story content in markdown format.

## Structure

- Each series gets its own subdirectory: `content/stories/series-slug/`
- Parts are numbered: `part-01.md`, `part-02.md`, etc.

## Format

```markdown
---
title: "Story Title - Part 1"
series: "Series Slug"
part: 1
published: 2024-01-15
---

Story content here...
```

## Usage

Stories are imported via the dashboard at `/dashboard/stories/import` using the JSON format, then can be exported here for archival purposes.
