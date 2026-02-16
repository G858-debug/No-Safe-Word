import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@no-safe-word/story-engine";

// GET /api/characters - List all characters
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? "50");
  const offset = Number(searchParams.get("offset") ?? "0");

  const { data, error, count } = await supabase
    .from("characters")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ characters: data, total: count });
}

// POST /api/characters - Create a new character
export async function POST(request: NextRequest) {
  const body = await request.json();

  const { name, description } = body;

  if (!name?.trim()) {
    return NextResponse.json(
      { error: "Character name is required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("characters")
    .insert({ name: name.trim(), description: description ?? {} })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data, { status: 201 });
}

// PUT /api/characters - Update a character (pass id in body)
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, name, description } = body;

  if (!id) {
    return NextResponse.json(
      { error: "Character id is required" },
      { status: 400 }
    );
  }

  const update: Record<string, unknown> = {};
  if (name !== undefined) update.name = name.trim();
  if (description !== undefined) update.description = description;

  const { data, error } = await supabase
    .from("characters")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Character not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(data);
}

// DELETE /api/characters - Delete a character (pass id in body)
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { id } = body;

  if (!id) {
    return NextResponse.json(
      { error: "Character id is required" },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("characters")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
