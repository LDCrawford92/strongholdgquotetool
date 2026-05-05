import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type AdminUserSearchResult = {
  id: string;
  email: string;
  username: string | null;
  fullName: string | null;
  role: "admin" | "user";
};

function getAdminSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function requireAdmin(request: NextRequest) {
  const supabaseAdmin = getAdminSupabase();
  if (!supabaseAdmin) {
    return {
      error: NextResponse.json({ error: "Password reset service is not configured." }, { status: 500 }),
      supabaseAdmin: null,
    };
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";

  if (!token) {
    return {
      error: NextResponse.json({ error: "Admin access required." }, { status: 401 }),
      supabaseAdmin,
    };
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  const user = userData.user;

  if (userError || !user) {
    return {
      error: NextResponse.json({ error: "Admin access required." }, { status: 401 }),
      supabaseAdmin,
    };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || profile?.role !== "admin") {
    return {
      error: NextResponse.json({ error: "Admin access required." }, { status: 403 }),
      supabaseAdmin,
    };
  }

  return { error: null, supabaseAdmin };
}

function normalizeSearchQuery(value: string) {
  return value.trim().replace(/[%,()]/g, " ");
}

export async function GET(request: NextRequest) {
  const { error, supabaseAdmin } = await requireAdmin(request);
  if (error || !supabaseAdmin) return error;

  const searchParams = request.nextUrl.searchParams;
  const query = normalizeSearchQuery(searchParams.get("q") ?? "");

  if (query.length < 2) {
    return NextResponse.json({ error: "Enter at least 2 characters to search." }, { status: 400 });
  }

  const pattern = `%${query}%`;
  const { data: profileRows, error: profilesError } = await supabaseAdmin
    .from("profiles")
    .select("id,username,full_name,role")
    .ilike("username", pattern)
    .limit(20);

  if (profilesError) {
    return NextResponse.json({ error: profilesError.message }, { status: 500 });
  }

  const profileById = new Map<string, { username?: string | null; fullName?: string | null; role?: string | null }>();

  for (const profile of profileRows ?? []) {
    const id = String(profile.id);
    const username = typeof profile.username === "string" ? profile.username : null;
    const fullName = typeof profile.full_name === "string" ? profile.full_name : null;
    const role = profile.role === "admin" ? "admin" : "user";

    profileById.set(id, { username, fullName, role });
  }

  const { data: authUsers, error: authUsersError } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (authUsersError) {
    return NextResponse.json({ error: authUsersError.message }, { status: 500 });
  }

  const results: AdminUserSearchResult[] = [];
  for (const authUser of authUsers.users) {
    const profile = profileById.get(authUser.id);
    if (!profile) continue;

    results.push({
      id: authUser.id,
      email: authUser.email ?? "",
      username: profile?.username ?? null,
      fullName: profile?.fullName ?? null,
      role: profile?.role === "admin" ? "admin" : "user",
    });
  }

  return NextResponse.json({
    users: results
      .sort((left, right) => (left.username ?? "").localeCompare(right.username ?? ""))
      .slice(0, 20),
  });
}

export async function POST(request: NextRequest) {
  const { error, supabaseAdmin } = await requireAdmin(request);
  if (error || !supabaseAdmin) return error;

  const body = await request.json().catch(() => null) as { userId?: unknown; password?: unknown } | null;
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!userId) {
    return NextResponse.json({ error: "Select a user before resetting their password." }, { status: 400 });
  }

  if (!password) {
    return NextResponse.json({ error: "Enter a temporary password." }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: "Temporary password must be at least 8 characters." }, { status: 400 });
  }

  const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (targetProfileError || !targetProfile) {
    return NextResponse.json({ error: "Selected user was not found." }, { status: 404 });
  }

  const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    password,
  });

  if (resetError) {
    return NextResponse.json({ error: resetError.message }, { status: 500 });
  }

  return NextResponse.json({
    message: "Password updated. Ask the user to log in with their temporary password and change it when available.",
  });
}
