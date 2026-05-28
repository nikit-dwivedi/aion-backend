-- Migration to disable Row-Level Security for connection pools
ALTER TABLE nodes DISABLE ROW LEVEL SECURITY;
ALTER TABLE edges DISABLE ROW LEVEL SECURITY;
ALTER TABLE events DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_nodes ON nodes;
DROP POLICY IF EXISTS tenant_isolation_events ON events;
DROP POLICY IF EXISTS tenant_isolation_edges ON edges;
