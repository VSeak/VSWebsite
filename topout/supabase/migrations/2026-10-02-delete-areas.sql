-- Every area can be deleted, even one check-ins use (the user asked). Deleting it takes its ratings and tags off those
-- check-ins and takes it off any Team Focus, instead of refusing. (Hiding it still keeps old ratings.)
begin;

drop trigger team_area_in_use on public.team_rating_areas;
drop function public.team_area_in_use();

create function public.team_area_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  k text := old.id::text;
begin
  update public.team_checkins c set
    ratings = c.ratings - k,
    coach_ratings = c.coach_ratings - k,
    tags = coalesce((select jsonb_object_agg(e.key, e.value - k) from jsonb_each(c.tags) e
                     where jsonb_array_length(e.value - k) > 0), '{}')
  where c.ratings ? k or c.coach_ratings ? k or exists (select 1 from jsonb_each(c.tags) e where e.value ? k);
  update public.team_focus set area_ids = array_remove(area_ids, old.id) where old.id = any (area_ids);
  return old;
end;
$$;
create trigger team_area_cleanup before delete on public.team_rating_areas
  for each row execute function public.team_area_cleanup();

commit;
