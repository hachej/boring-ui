package main

import "testing"

func TestNextAvailableProjectIDProbesCollisions(t *testing.T) {
	used := map[uint32]struct{}{0x10000: {}, 0x10001: {}}
	projectID, err := nextAvailableProjectID(0x10000, used)
	if err != nil {
		t.Fatal(err)
	}
	if projectID != 0x10002 {
		t.Fatalf("got project id %x", projectID)
	}
}

func TestNextAvailableProjectIDKeepsFreeInitialValue(t *testing.T) {
	projectID, err := nextAvailableProjectID(0x12345, map[uint32]struct{}{})
	if err != nil {
		t.Fatal(err)
	}
	if projectID != 0x12345 {
		t.Fatalf("got project id %x", projectID)
	}
}

func TestReserveCapacityFaultMatrix(t *testing.T) {
	const gib = uint64(1024 * 1024 * 1024)
	if !reserveCapacityAvailable(100*gib, 50*gib, 90, false) {
		t.Fatal("expected existing fixed allocations to preserve ten percent")
	}
	if reserveCapacityAvailable(100*gib, 50*gib, 91, true) {
		t.Fatal("expected aggregate fixed allocations to preserve ten percent")
	}
	if reserveCapacityAvailable(200*gib, 20*gib, 1, true) {
		t.Fatal("expected a new allocation to require reserve plus one quota")
	}
	if !reserveCapacityAvailable(200*gib, 21*gib, 1, true) {
		t.Fatal("expected exact reserve plus one quota to pass")
	}
	if reserveCapacityAvailable(8*gib, 8*gib, 1, true) {
		t.Fatal("expected a volume smaller than the ten GiB reserve to fail")
	}
}
