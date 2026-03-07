export async function hasNotificationBeenSent({
  supabase,
  bookingId,
  userId,
  notificationType,
}: {
  supabase: any;
  bookingId: string;
  userId: string | null;
  notificationType: string;
}) {
  const { data, error } = await supabase
    .from("notification_log")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("notification_type", notificationType)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error checking notification_log:", error);
    throw error;
  }

  return !!data;
}

export async function logNotificationSent({
  supabase,
  bookingId,
  userId,
  emailTo,
  notificationType,
  meta = {},
}: {
  supabase: any;
  bookingId: string;
  userId: string | null;
  emailTo: string;
  notificationType: string;
  meta?: Record<string, unknown>;
}) {
  const { error } = await supabase.from("notification_log").insert({
    booking_id: bookingId,
    user_id: userId,
    email_to: emailTo,
    notification_type: notificationType,
    meta,
  });

  if (error) {
    console.error("Error inserting notification_log:", error);
    throw error;
  }
}