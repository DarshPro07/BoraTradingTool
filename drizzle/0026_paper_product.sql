-- Paper product: DELIVERY or INTRADAY on every paper order and position.
--
-- India charges the same trade very differently by holding period: a ₹1,000 delivery round trip
-- costs ~1.8% (the flat ₹15.93 DP charge), the same trade squared off intraday ~0.11%. The paper
-- engine had no product, so every fill was priced as delivery and an intraday strategy could not be
-- measured at all. Owner instruction 2026-09-19: "Add intraday to paper".
--
-- Existing rows are DELIVERY because that is how every one of them was priced.

ALTER TABLE paper_orders ADD COLUMN product TEXT NOT NULL DEFAULT 'DELIVERY';
ALTER TABLE paper_positions ADD COLUMN product TEXT NOT NULL DEFAULT 'DELIVERY';
