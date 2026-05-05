-- =====================================================================
-- Bulk operations for the admin dashboard.
--
-- Adds RPCs the admin uses to make changes across many products at once
-- in a single round-trip. All restricted to service_role.
-- =====================================================================

-- Add or remove every tag from a category's rule, across many products.
-- Returns the number of products that were updated.
create or replace function bulk_set_category_membership(
  p_product_ids   uuid[],
  p_category_id   uuid,
  p_in_category   boolean
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  rule_tags text[];
  affected  int := 0;
begin
  select array(select jsonb_array_elements_text(rule->'tags'))
    into rule_tags
    from categories
   where id = p_category_id;

  if rule_tags is null or array_length(rule_tags, 1) is null then
    raise exception 'Category % has no tag-based rule', p_category_id;
  end if;

  if p_in_category then
    -- Add all of the category's rule tags to each selected product (dedup).
    with updated as (
      update products
         set tags = (
           select coalesce(array_agg(distinct t order by t), '{}')
             from unnest(tags || rule_tags) as t
         )
       where id = any(p_product_ids)
       returning id
    )
    select count(*) into affected from updated;
  else
    -- Remove all of the category's rule tags from each selected product.
    with updated as (
      update products
         set tags = (
           select coalesce(array_agg(t), '{}')
             from unnest(tags) as t
            where not (t = any(rule_tags))
         )
       where id = any(p_product_ids)
       returning id
    )
    select count(*) into affected from updated;
  end if;
  return affected;
end;
$$;

revoke execute on function bulk_set_category_membership(uuid[], uuid, boolean) from public, anon;

-- Bulk delete with the right cascade order: drop guesses pointing at these
-- products first (FK has no ON DELETE CASCADE), then drop the products
-- themselves (product_categories cascades from products).
create or replace function bulk_delete_products(p_product_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  affected int := 0;
begin
  delete from guesses where product_id = any(p_product_ids);
  with d as (
    delete from products where id = any(p_product_ids) returning id
  ) select count(*) into affected from d;
  return affected;
end;
$$;

revoke execute on function bulk_delete_products(uuid[]) from public, anon;
