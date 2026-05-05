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

  if (!supabaseUrl || !serviceRoleKey) return null;

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
      error: NextResponse.json({ error: "User management service is not configured." }, { status: 500 }),
      supabaseAdmin: null,
      adminUserId: null,
    };
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";

  if (!token) {
    return {
      error: NextResponse.json({ error: "Admin access required." }, { status: 401 }),
      supabaseAdmin,
      adminUserId: null,
    };
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  const user = userData.user;

  if (userError || !user) {
    return {
      error: NextResponse.json({ error: "Admin access required." }, { status: 401 }),
      supabaseAdmin,
      adminUserId: null,
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
      adminUserId: null,
    };
  }

  return { error: null, supabaseAdmin, adminUserId: user.id };
}

function normalizeSearchQuery(value: string) {
  return value.trim().toLowerCase().replace(/[%,()]/g, " ");
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function isValidUsername(value: string) {
  return /^[a-z0-9._-]+$/.test(value);
}

function strongholdEmail(username: string) {
  return `${username}@stronghold.local`;
}

async function searchUsers(supabaseAdmin: NonNullable<ReturnType<typeof getAdminSupabase>>, query: string) {
  const { data: profileRows, error: profilesError } = await supabaseAdmin
    .from("profiles")
    .select("id,username,full_name,role");

  if (profilesError) {
    return { users: null, error: profilesError };
  }

  const { data: authUsers, error: authUsersError } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (authUsersError) {
    return { users: null, error: authUsersError };
  }

  const emailById = new Map(authUsers.users.map((user) => [user.id, user.email ?? ""]));
  const normalizedQuery = normalizeSearchQuery(query);
  const users: AdminUserSearchResult[] = [];

  for (const profile of profileRows ?? []) {
    const id = String(profile.id);
    const username = typeof profile.username === "string" ? profile.username : "";
    const fullName = typeof profile.full_name === "string" ? profile.full_name : "";
    const email = emailById.get(id) ?? "";
    const haystack = `${username} ${fullName} ${email}`.toLowerCase();

    if (!haystack.includes(normalizedQuery)) continue;

    users.push({
      id,
      email,
      username: username || null,
      fullName: fullName || null,
      role: profile.role === "admin" ? "admin" : "user",
    });
  }

  return {
    users: users
      .sort((left, right) => (left.username ?? left.email).localeCompare(right.username ?? right.email))
      .slice(0, 20),
    error: null,
  };
}

export async function GET(request: NextRequest) {
  const { error, supabaseAdmin } = await requireAdmin(request);
  if (error) return error;
  if (!supabaseAdmin) return NextResponse.json({ error: "User management service is not configured." }, { status: 500 });

  const query = request.nextUrl.searchParams.get("q") ?? "";
  if (normalizeSearchQuery(query).length < 2) {
    return NextResponse.json({ error: "Enter at least 2 characters to search." }, { status: 400 });
  }

  const result = await searchUsers(supabaseAdmin, query);
  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ users: result.users ?? [] });
}

export async function POST(request: NextRequest) {
  const { error, supabaseAdmin } = await requireAdmin(request);
  if (error) return error;
  if (!supabaseAdmin) return NextResponse.json({ error: "User management service is not configured." }, { status: 500 });

  const body = await request.json().catch(() => null) as {
    username?: unknown;
    fullName?: unknown;
    password?: unknown;
  } | null;
  const username = normalizeUsername(typeof body?.username === "string" ? body.username : "");
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!username) return NextResponse.json({ error: "Enter a username." }, { status: 400 });
  if (!isValidUsername(username)) {
    return NextResponse.json({ error: "Username can only use letters, numbers, dots, dashes, and underscores." }, { status: 400 });
  }
  if (!fullName) return NextResponse.json({ error: "Enter a full name." }, { status: 400 });
  if (!password) return NextResponse.json({ error: "Enter a temporary password." }, { status: 400 });
  if (password.length < 8) {
    return NextResponse.json({ error: "Temporary password must be at least 8 characters." }, { status: 400 });
  }

  const email = strongholdEmail(username);
  const existing = await searchUsers(supabaseAdmin, username);
  if (existing.error) {
    return NextResponse.json({ error: existing.error.message }, { status: 500 });
  }

  if ((existing.users ?? []).some((user) => user.username?.toLowerCase() === username || user.email.toLowerCase() === email)) {
    return NextResponse.json({ error: "A user with that username already exists." }, { status: 409 });
  }

  const { data: authUsers, error: authUsersError } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (authUsersError) {
    return NextResponse.json({ error: authUsersError.message }, { status: 500 });
  }

  if (authUsers.users.some((user) => user.email?.toLowerCase() === email)) {
    return NextResponse.json({ error: "A user with that username already exists." }, { status: 409 });
  }

  const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !createdUser.user) {
    const alreadyExists = createError?.message.toLowerCase().includes("already") ?? false;
    const message = alreadyExists
      ? "A user with that username already exists."
      : createError?.message ?? "Unable to create user.";
    return NextResponse.json({ error: message }, { status: alreadyExists ? 409 : 500 });
  }

  const { error: profileError } = await supabaseAdmin
    .from("profiles")
    .upsert({
      id: createdUser.user.id,
      username,
      full_name: fullName,
      role: "user",
    }, { onConflict: "id" });

  if (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(createdUser.user.id);
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  return NextResponse.json({
    user: {
      id: createdUser.user.id,
      email,
      username,
      fullName,
      role: "user",
    },
    message: `User ${username} created. Ask them to log in with their temporary password.`,
  });
}

export async function PATCH(request: NextRequest) {
  const { error, supabaseAdmin } = await requireAdmin(request);
  if (error) return error;
  if (!supabaseAdmin) return NextResponse.json({ error: "User management service is not configured." }, { status: 500 });

  const body = await request.json().catch(() => null) as { userId?: unknown; password?: unknown } | null;
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!userId) return NextResponse.json({ error: "Select a user before resetting their password." }, { status: 400 });
  if (!password) return NextResponse.json({ error: "Enter a temporary password." }, { status: 400 });
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

  const { error: resetError } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
  if (resetError) {
    return NextResponse.json({ error: resetError.message }, { status: 500 });
  }

  return NextResponse.json({
    message: "Password updated. Ask the user to log in with their temporary password.",
  });
}

export async function DELETE(request: NextRequest) {
  const { error, supabaseAdmin, adminUserId } = await requireAdmin(request);
  if (error) return error;
  if (!supabaseAdmin || !adminUserId) {
    return NextResponse.json({ error: "User management service is not configured." }, { status: 500 });
  }

  const body = await request.json().catch(() => null) as { userId?: unknown; confirmation?: unknown } | null;
  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  const confirmation = typeof body?.confirmation === "string" ? body.confirmation.trim() : "";

  if (!userId) return NextResponse.json({ error: "Select a user before deleting." }, { status: 400 });
  if (confirmation !== "DELETE") return NextResponse.json({ error: "Type DELETE to confirm." }, { status: 400 });
  if (userId === adminUserId) {
    return NextResponse.json({ error: "You cannot delete your own currently logged-in user." }, { status: 400 });
  }

  const { data: targetProfile, error: targetProfileError } = await supabaseAdmin
    .from("profiles")
    .select("id,role")
    .eq("id", userId)
    .maybeSingle();

  if (targetProfileError || !targetProfile) {
    return NextResponse.json({ error: "Selected user was not found." }, { status: 404 });
  }

  if (targetProfile.role === "admin") {
    const { count, error: countError } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");

    if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: "You cannot delete the last remaining admin." }, { status: 400 });
    }
  }

  const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (deleteAuthError) {
    return NextResponse.json({ error: deleteAuthError.message }, { status: 500 });
  }

  await supabaseAdmin.from("profiles").delete().eq("id", userId);

  return NextResponse.json({ message: "User deleted." });
}
