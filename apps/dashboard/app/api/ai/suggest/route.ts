import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

export async function POST(request: NextRequest) {
  try {
    const { content, type, context } = await request.json();

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not configured' },
        { status: 500 }
      );
    }

    if (!content) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      );
    }

    let prompt = '';

    if (type === 'facebook') {
      prompt = `You are an expert editor for erotic fiction social media posts. Review this Facebook post and suggest improvements.

Focus on:
- Engaging opening line
- Building tension and intrigue
- Appropriate hashtags
- Call to action
- Keep it SFW but suggestive
- South African English and context

Current content:
${content}

Provide 2-3 specific suggestions for improvement.`;
    } else if (type === 'website') {
      prompt = `You are an expert editor for erotic fiction. Review this story content and suggest improvements.

Focus on:
- Narrative flow and pacing
- Character development
- Sensory details
- Dialogue authenticity
- Emotional depth
- South African context and language

Current content:
${content}

Provide 2-3 specific suggestions for improvement.`;
    } else if (type === 'continuation') {
      prompt = `You are an expert editor for serialized erotic fiction. Review this story part and suggest how to maintain consistency in the next part.

Context from previous parts:
${context || 'N/A'}

Current part:
${content}

Suggest:
1. Key plot points to carry forward
2. Character development opportunities
3. Tension/pacing recommendations for the next part`;
    } else {
      return NextResponse.json(
        { error: 'Invalid type. Must be "facebook", "website", or "continuation"' },
        { status: 400 }
      );
    }

    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: prompt,
      }],
    });

    const suggestion = message.content[0].type === 'text'
      ? message.content[0].text
      : 'Unable to generate suggestion';

    return NextResponse.json({
      suggestion,
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
      },
    });
  } catch (err: any) {
    console.error('AI suggestion error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to generate suggestion' },
      { status: 500 }
    );
  }
}
