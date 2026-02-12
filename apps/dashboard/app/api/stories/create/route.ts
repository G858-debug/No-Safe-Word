import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@no-safe-word/story-engine';
import { slugify, type StorySeriesRow } from '@no-safe-word/shared';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, description, total_parts, hashtag } = body;

    // Validate required fields
    if (!title || !total_parts) {
      return NextResponse.json(
        { error: 'Title and total_parts are required' },
        { status: 400 }
      );
    }

    // Generate slug from title
    const slug = slugify(title);

    // Check if slug already exists
    const { data: existing } = await supabase
      .from('story_series')
      .select('id')
      .eq('slug', slug)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: 'A story with this title already exists' },
        { status: 409 }
      );
    }

    // Create the story series
    const { data, error } = await supabase
      .from('story_series')
      .insert({
        title,
        slug,
        description: description || null,
        total_parts: parseInt(total_parts),
        hashtag: hashtag || null,
        status: 'draft',
        marketing: {},
      })
      .select()
      .single();

    if (error || !data) {
      console.error('Error creating story series:', error);
      return NextResponse.json(
        { error: error?.message || 'Failed to create story series' },
        { status: 500 }
      );
    }

    const series = data as StorySeriesRow;

    // Create empty posts for each part
    const posts = Array.from({ length: total_parts }, (_, i) => ({
      series_id: series.id,
      part_number: i + 1,
      title: `${title} - Part ${i + 1}`,
      facebook_content: '',
      facebook_teaser: '',
      facebook_comment: '',
      website_content: '',
      hashtags: hashtag ? [hashtag] : [],
      status: 'draft',
    }));

    const { error: postsError } = await supabase
      .from('story_posts')
      .insert(posts);

    if (postsError) {
      console.error('Error creating story posts:', postsError);
      // Don't fail the request, posts can be added manually
    }

    return NextResponse.json({ series });
  } catch (err: any) {
    console.error('Unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
