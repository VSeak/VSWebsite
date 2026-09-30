#!/bin/sh
# Sit Start and Top Out share one Supabase project, so each email has ONE template for both apps.
# This joins the two halves: Top Out's when the login's data has topout = true (team_stamp_sender / sendLink
# in topout/), Sit Start's otherwise. Run from the repo root after changing either half, then re-paste:
#   sh supabase-emails/build.sh
# Supabase → Authentication → Emails → Templates: paste each file below into the template of the same name,
# and set its subject to the line under "Subject:" in the file's first comment.
cd "$(dirname "$0")/.." || exit 1
strip() { awk 'done { print; next } /-->/ { done = 1 }' "$1"; }   # drops the file's opening comment
for name in confirm-signup magic-link reset-password; do
  case $name in
    confirm-signup) subject='{{ if .Data.topout }}Top Out: You'"'"'re Invited 🧗{{ else }}Sit Start: {{ if .Data.staff }}You'"'"'re Invited{{ else }}Your Training Plan Is Ready{{ end }} 🧗{{ end }}' ;;
    magic-link) subject='{{ if .Data.topout }}Top Out: Your Sign-In Link 🧗{{ else }}Sit Start: {{ if .Data.email_changed_to }}Your Email Was Changed{{ else }}Your Sign-In Link{{ end }} 🧗{{ end }}' ;;
    reset-password) subject='{{ if .Data.topout }}Top Out{{ else }}Sit Start{{ end }}: Reset Your Password 🧗' ;;
  esac
  {
    echo "<!-- Supabase → Authentication → Emails → Templates → $name. Made by supabase-emails/build.sh: edit"
    echo "     sitstart/supabase/emails/$name.html or topout/supabase/emails/$name.html instead, then run it again."
    echo "     Subject: $subject -->"
    echo "{{ if .Data.topout }}"
    strip "topout/supabase/emails/$name.html"
    echo "{{ else }}"
    strip "sitstart/supabase/emails/$name.html"
    echo "{{ end }}"
  } > "supabase-emails/$name.html"
done
echo "Built supabase-emails/*.html"
